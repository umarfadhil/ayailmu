package id.petalytix.ayailmu.core.engine

import id.petalytix.ayailmu.core.content.GatedContent
import id.petalytix.ayailmu.core.model.AnswerEvent
import id.petalytix.ayailmu.core.model.Response
import kotlinx.coroutines.sync.Mutex

/**
 * Storage contract the controller needs. Implemented by :core:data on Room in P2; tests use an in-memory
 * version. `recordAnswer` must be atomic: the event and the snapshot are written together or not at all.
 */
interface SessionStore {
    suspend fun recordAnswer(
        event: AnswerEvent,
        snapshot: SessionState,
    )

    suspend fun saveSnapshot(snapshot: SessionState)

    suspend fun saveScreensSeen(screenIds: List<String>)
}

enum class SaveResult { SAVED, IGNORED, FAILED }

/**
 * Connects the pure session engine to storage (ported from the prototype). The UI only sees a new state
 * after the matching write has succeeded, so a lost write never looks saved; re-entrant or repeated submits
 * are ignored (one answer event per item).
 */
class SessionController(
    private val store: SessionStore,
    private val content: GatedContent,
    private val rules: RuleConfig,
    initialState: SessionState,
    history: List<AnswerEvent>,
    screensSeen: List<String>,
    private val clock: Clock,
    private val ids: IdGenerator = UuidIdGenerator,
) {
    var state: SessionState = initialState
        private set
    var history: List<AnswerEvent> = history
        private set
    var screensSeen: List<String> = screensSeen
        private set
    var error: String? = null
        private set

    private val gate = Mutex()
    val isBusy: Boolean get() = gate.isLocked

    private suspend fun guarded(task: suspend () -> SaveResult): SaveResult {
        if (!gate.tryLock()) return SaveResult.IGNORED
        try {
            val r = task()
            if (r == SaveResult.SAVED) error = null
            return r
        } catch (e: Exception) {
            error = e.message ?: e.toString()
            return SaveResult.FAILED
        } finally {
            gate.unlock()
        }
    }

    suspend fun submit(
        response: Response,
        timeOnItemMs: Long,
        hintUsed: Boolean = false,
    ): SaveResult =
        guarded {
            val r =
                Session.submit(
                    state,
                    response,
                    Env(content, rules, history, clock.now().toEpochMilli(), timeOnItemMs, hintUsed, ids),
                )
            val event = r.event ?: return@guarded SaveResult.IGNORED
            store.recordAnswer(event, r.state) // atomic: answer + snapshot
            history = history + event
            state = r.state
            SaveResult.SAVED
        }

    suspend fun next(): SaveResult =
        guarded {
            val nextState = Session.advance(state, clock.now().toEpochMilli())
            if (nextState === state) return@guarded SaveResult.IGNORED
            val newScreens = nextState.seenScreens.filter { it !in screensSeen }
            if (newScreens.isNotEmpty()) store.saveScreensSeen(screensSeen + newScreens)
            store.saveSnapshot(nextState)
            if (newScreens.isNotEmpty()) screensSeen = screensSeen + newScreens
            state = nextState
            SaveResult.SAVED
        }
}
