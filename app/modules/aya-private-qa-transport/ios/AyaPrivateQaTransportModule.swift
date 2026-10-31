import ExpoModulesCore
import Foundation
import Security

// Bounded private-QA transport. Every request gets its own ephemeral URLSession
// whose delegate trusts only the bundled private CA for https://localhost on the
// two fixed ports. All registry state, delegate callbacks, and deadline timers run
// on one serial queue, so each request settles exactly once.
fileprivate func refuse(_ promise: Promise) {
  promise.reject("ERR_AYA_PRIVATE_QA", "Private QA request failed")
}

public final class AyaPrivateQaTransportModule: Module {
  private static let maxActive = 32
  private static let maxRetired = 1024
  private static let maxCancelIdBytes = 128

  private let queue = DispatchQueue(label: "id.petalytix.aya.private-qa-transport")
  private var policyLoaded = false
  private var policy: PrivateQaPolicy?
  private var active: [String: Exchange] = [:]
  private var retired = Set<String>()
  private var closed = false

  public func definition() -> ModuleDefinition {
    Name("AyaPrivateQaTransport")

    Function("binding") { () -> [String: Any]? in
      self.queue.sync { () -> [String: Any]? in
        guard !self.closed else { return nil }
        return self.loadPolicy()?.binding
      }
    }

    AsyncFunction("request") { (input: [String: Any], promise: Promise) in
      let deadline = DispatchTime.now() + .seconds(10)
      self.queue.async { self.submit(input, promise, deadline: deadline) }
    }

    Function("cancel") { (id: String) in
      self.queue.sync { self.cancel(id) }
    }

    OnDestroy {
      self.queue.sync { self.closeAll() }
    }
  }

  private func loadPolicy() -> PrivateQaPolicy? {
    if !policyLoaded {
      policy = PrivateQaPolicy.load()
      policyLoaded = true
    }
    return policy
  }

  private func submit(_ input: [String: Any], _ promise: Promise, deadline: DispatchTime) {
    guard !closed, let policy = loadPolicy(),
          let prepared = PrivateQaPolicy.prepare(input),
          let port = URL(string: prepared.url)?.port,
          active.count < Self.maxActive, reserve(prepared.id)
    else { return refuse(promise) }

    let id = prepared.id
    let exchange = Exchange(url: prepared.url, port: port, policy: policy, promise: promise) { [weak self] in
      self?.active.removeValue(forKey: id)
    }
    active[id] = exchange
    exchange.start(prepared.request, queue: queue, deadline: deadline)
  }

  // Ids are single-use. Overflow closes the transport permanently, aborting active
  // exchanges, instead of evicting, so a retired or pre-cancelled id can never be
  // started again.
  private func reserve(_ id: String) -> Bool {
    guard !closed, !retired.contains(id) else { return false }
    guard retired.count < Self.maxRetired else {
      closeAll()
      return false
    }
    retired.insert(id)
    return true
  }

  private func cancel(_ id: String) {
    if let exchange = active[id] {
      exchange.finish(nil)
      return
    }
    guard !id.isEmpty, id.utf8.count <= Self.maxCancelIdBytes else { return }
    // Record an unknown id so a request still queued behind this cancel is refused.
    _ = reserve(id)
  }

  private func closeAll() {
    closed = true
    let exchanges = Array(active.values)
    active.removeAll()
    exchanges.forEach { $0.finish(nil) }
  }
}

private final class Exchange: NSObject, URLSessionDataDelegate {
  private static let maxBody = 2 * 1024 * 1024

  private let url: String
  private let port: Int
  private let policy: PrivateQaPolicy
  private var promise: Promise?
  private var onFinish: (() -> Void)?
  private var session: URLSession?
  private var task: URLSessionDataTask?
  private var timer: DispatchSourceTimer?
  private var response: HTTPURLResponse?
  private var body = Data()

  init(url: String, port: Int, policy: PrivateQaPolicy, promise: Promise, onFinish: @escaping () -> Void) {
    self.url = url
    self.port = port
    self.policy = policy
    self.promise = promise
    self.onFinish = onFinish
    super.init()
  }

  func start(_ request: URLRequest, queue: DispatchQueue, deadline: DispatchTime) {
    // A request that expired while queued is refused before any timer, session, or task exists.
    guard DispatchTime.now().uptimeNanoseconds < deadline.uptimeNanoseconds else { return finish(nil) }

    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: deadline)
    timer.setEventHandler { [weak self] in self?.finish(nil) }
    self.timer = timer
    timer.resume()

    let config = URLSessionConfiguration.ephemeral
    config.httpCookieStorage = nil
    config.urlCredentialStorage = nil
    config.urlCache = nil
    config.httpShouldSetCookies = false
    config.httpCookieAcceptPolicy = .never
    config.requestCachePolicy = .reloadIgnoringLocalCacheData
    config.timeoutIntervalForRequest = 10
    config.timeoutIntervalForResource = 10
    config.waitsForConnectivity = false
    config.connectionProxyDictionary = [:]

    let operations = OperationQueue()
    operations.maxConcurrentOperationCount = 1
    operations.underlyingQueue = queue

    let session = URLSession(configuration: config, delegate: self, delegateQueue: operations)
    let task = session.dataTask(with: request)
    self.session = session
    self.task = task
    task.resume()
  }

  // Settles once, then tears down the task, session (releasing its delegate
  // reference to self), timer, and registry entry. Must run on the serial queue.
  func finish(_ result: [String: Any]?) {
    guard let promise = promise else { return }
    self.promise = nil
    timer?.setEventHandler {}
    timer?.cancel()
    timer = nil
    task?.cancel()
    task = nil
    session?.invalidateAndCancel()
    session = nil
    response = nil
    body = Data()
    let done = onFinish
    onFinish = nil
    done?()
    if let result = result {
      promise.resolve(result)
    } else {
      refuse(promise)
    }
  }

  func urlSession(
    _ session: URLSession, didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    decide(challenge, completionHandler)
  }

  func urlSession(
    _ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    decide(challenge, completionHandler)
  }

  // Server trust for the exact localhost port only; never falls back to default handling.
  private func decide(
    _ challenge: URLAuthenticationChallenge,
    _ completionHandler: (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    let space = challenge.protectionSpace
    guard promise != nil,
          space.authenticationMethod == NSURLAuthenticationMethodServerTrust,
          space.host == "localhost", space.port == port,
          let trust = space.serverTrust,
          policy.accept(trust, host: space.host, port: space.port)
    else { return completionHandler(.cancelAuthenticationChallenge, nil) }
    completionHandler(.useCredential, URLCredential(trust: trust))
  }

  // Never follow; the original 3xx response is handed to the JS resolver.
  func urlSession(
    _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void
  ) {
    completionHandler(nil)
  }

  func urlSession(
    _ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
  ) {
    guard promise != nil, let http = response as? HTTPURLResponse,
          http.url?.absoluteString == url,
          (100...599).contains(http.statusCode),
          http.expectedContentLength <= Int64(Self.maxBody)
    else {
      completionHandler(.cancel)
      return finish(nil)
    }
    self.response = http
    completionHandler(.allow)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    guard promise != nil, response != nil else { return }
    guard data.count <= Self.maxBody - body.count else { return finish(nil) }
    body.append(data)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    guard promise != nil else { return }
    guard error == nil, let http = response else { return finish(nil) }
    // Strict UTF-8: lossy decoding would change the bytes on re-encode.
    let text = String(decoding: body, as: UTF8.self)
    guard Data(text.utf8) == body else { return finish(nil) }
    var headers: [String: String] = [:]
    for (key, value) in http.allHeaderFields {
      guard let name = key as? String, let value = value as? String,
            name.lowercased() != "set-cookie"
      else { continue }
      headers[name] = value
    }
    finish(["status": http.statusCode, "headers": headers, "body": text, "url": url])
  }
}
