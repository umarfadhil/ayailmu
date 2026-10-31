package expo.modules.ayaprivateqa

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.ThreadFactory
import java.util.concurrent.TimeUnit
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Response

// The native bridge behind auth/privateQaTransport.ts. Every request goes through the policy's
// single CA-pinned OkHttp client; there is no fallback to any other client or to global fetch.
// A request is owned by its Run while it sits in `active`: whoever removes it there (reply,
// failure, deadline, cancel or close) is the only one that settles its promise.
class AyaPrivateQaTransportModule : Module() {
  private class Run(val id: String, val promise: Promise) {
    var call: Call? = null
    var timer: ScheduledFuture<*>? = null
  }

  private val lock = Any()
  private val active = HashMap<String, Run>()
  // Every id ever reserved, so none is reused; and ids cancelled before their request arrived.
  private val used = HashSet<String>()
  private val cancelled = HashSet<String>()
  private var closed = false
  private var loaded = false
  private var policy: PrivateQaPolicy? = null
  private var client: OkHttpClient? = null
  private var deadlines: ScheduledThreadPoolExecutor? = null

  override fun definition() = ModuleDefinition {
    Name("AyaPrivateQaTransport")

    Function("binding") { binding() }

    AsyncFunction("request") { input: Map<String, Any?>, promise: Promise -> submit(input, promise) }

    Function("cancel") { id: String -> cancel(id) }

    OnDestroy { close() }
  }

  private fun binding(): Map<String, Any>? = synchronized(lock) { policyLocked()?.binding() }

  // The policy from the app's assets, loaded once; null when closed or the assets are absent.
  private fun policyLocked(): PrivateQaPolicy? {
    if (closed) return null
    if (!loaded) {
      val context = appContext.reactContext?.applicationContext ?: return null
      loaded = true
      policy = PrivateQaPolicy.load(context)
    }
    return policy
  }

  private fun submit(input: Map<String, Any?>, promise: Promise) {
    val deadline = System.nanoTime() + TIMEOUT_NANOS
    val prepared = PrivateQaPolicy.prepare(input) ?: return fail(promise)
    val run = Run(prepared.id, promise)
    var overflow = false
    val started = synchronized(lock) {
      when {
        policyLocked()?.binding() == null || prepared.id in used -> false
        used.size >= MAX_USED_IDS -> {
          overflow = true
          false
        }
        else -> {
          used.add(prepared.id)
          if (cancelled.remove(prepared.id) || active.size >= MAX_ACTIVE) false
          else startLocked(run, prepared, deadline)
        }
      }
    }
    if (overflow) close()
    if (!started) fail(promise)
  }

  // Registers the run, arms its deadline and enqueues it in one step, so a cancel or deadline
  // either finds nothing (and the run never starts) or finds a call it can abort.
  private fun startLocked(run: Run, prepared: PrivateQaPolicy.Prepared, deadline: Long): Boolean {
    val policy = policy ?: return false
    val http = client ?: policy.client()?.also { client = it } ?: return false
    val timers = deadlines ?: newDeadlines().also { deadlines = it }
    val remaining = deadline - System.nanoTime()
    if (remaining <= 0) return false
    val call = http.newCall(prepared.request)
    run.call = call
    active[run.id] = run
    return try {
      run.timer = timers.schedule(Runnable { finish(run, null) }, remaining, TimeUnit.NANOSECONDS)
      call.enqueue(callback(run, prepared))
      true
    } catch (_: Exception) {
      if (active[run.id] === run) active.remove(run.id)
      run.timer?.cancel(false)
      call.cancel()
      false
    }
  }

  private fun callback(run: Run, prepared: PrivateQaPolicy.Prepared) = object : Callback {
    override fun onFailure(call: Call, e: IOException) = finish(run, null)

    override fun onResponse(call: Call, response: Response) {
      val reply = try {
        response.use { reply(run, prepared, it) }
      } catch (_: Exception) {
        null
      }
      finish(run, reply)
    }
  }

  private fun reply(run: Run, prepared: PrivateQaPolicy.Prepared, response: Response): Map<String, Any>? {
    if (synchronized(lock) { active[run.id] !== run }) return null
    if (response.code !in 100..599 || response.request.url != prepared.request.url ||
      response.priorResponse != null || response.cacheResponse != null) return null
    if (response.headers("Content-Encoding").any { !it.trim().equals("identity", ignoreCase = true) }) return null
    val body = readBody(response) ?: return null
    val headers = LinkedHashMap<String, Any>()
    for (name in response.headers.names()) {
      val key = name.lowercase()
      if (key == "set-cookie") continue
      headers[key] = response.headers.values(name).joinToString(", ")
    }
    return linkedMapOf("status" to response.code, "headers" to headers, "body" to body, "url" to prepared.originalUrl)
  }

  // The body as strict UTF-8, read in bounded chunks; null when it is larger than allowed or not UTF-8.
  private fun readBody(response: Response): String? {
    val body = response.body ?: return null
    val length = body.contentLength()
    if (length > MAX_BODY_BYTES) return null
    val out = ByteArrayOutputStream(if (length in 1..MAX_BODY_BYTES) length.toInt() else CHUNK_BYTES)
    val chunk = ByteArray(CHUNK_BYTES)
    body.byteStream().use { stream ->
      while (true) {
        val count = stream.read(chunk)
        if (count < 0) break
        if (out.size() + count > MAX_BODY_BYTES) return null
        out.write(chunk, 0, count)
      }
    }
    return try {
      Charsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
        .decode(ByteBuffer.wrap(out.toByteArray()))
        .toString()
    } catch (_: Exception) {
      null
    }
  }

  private fun cancel(id: String) {
    if (id.isEmpty() || id.length > MAX_ID_CHARS) return
    var overflow = false
    val found = synchronized(lock) {
      if (closed) return
      val run = active.remove(id)
      // Not yet seen: remembered so that a request still queued behind this cancel never starts.
      if (run == null && id !in used && id !in cancelled) {
        if (cancelled.size >= MAX_UNKNOWN_CANCELS) overflow = true else cancelled.add(id)
      }
      run
    }
    found?.let { conclude(it, null) }
    if (overflow) close()
  }

  // Settles `run` only if it still owns its slot; a late outcome after cancel or deadline is dropped.
  private fun finish(run: Run, reply: Map<String, Any>?) {
    synchronized(lock) {
      if (active[run.id] !== run) return
      active.remove(run.id)
    }
    conclude(run, reply)
  }

  // Called outside the lock, once per run, by whoever removed it from `active`.
  private fun conclude(run: Run, reply: Map<String, Any>?) {
    run.timer?.cancel(false)
    if (reply == null) run.call?.cancel()
    try {
      if (reply == null) fail(run.promise) else run.promise.resolve(reply)
    } catch (_: Exception) {
      // The JS side may already be gone; the run is retired either way.
    }
  }

  private fun fail(promise: Promise) = promise.reject(ERROR_CODE, ERROR_MESSAGE, null)

  // Refuses everything from now on and releases only what this module created.
  private fun close() {
    val runs: List<Run>
    val ownClient: OkHttpClient?
    val ownDeadlines: ScheduledThreadPoolExecutor?
    synchronized(lock) {
      closed = true
      policy = null
      runs = active.values.toList()
      active.clear()
      ownClient = client
      client = null
      ownDeadlines = deadlines
      deadlines = null
    }
    runs.forEach { conclude(it, null) }
    try {
      ownClient?.let {
        it.dispatcher.cancelAll()
        it.dispatcher.executorService.shutdown()
        it.connectionPool.evictAll()
      }
    } catch (_: Exception) {
      // Best effort: nothing more can be sent through this client.
    }
    ownDeadlines?.shutdownNow()
  }

  private fun newDeadlines() =
    ScheduledThreadPoolExecutor(1, ThreadFactory { task -> Thread(task, "aya-private-qa-deadline").apply { isDaemon = true } })
      .apply { removeOnCancelPolicy = true }

  private companion object {
    const val ERROR_CODE = "ERR_AYA_PRIVATE_QA"
    const val ERROR_MESSAGE = "Private QA request failed"
    val TIMEOUT_NANOS = TimeUnit.SECONDS.toNanos(10)
    const val MAX_ACTIVE = 32
    const val MAX_USED_IDS = 1024
    const val MAX_UNKNOWN_CANCELS = 128
    const val MAX_ID_CHARS = 128
    const val MAX_BODY_BYTES = 2 * 1024 * 1024
    const val CHUNK_BYTES = 8192
  }
}
