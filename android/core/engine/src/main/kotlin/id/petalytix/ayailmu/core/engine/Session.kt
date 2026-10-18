package id.petalytix.ayailmu.core.engine

import id.petalytix.ayailmu.core.content.ContentJson
import id.petalytix.ayailmu.core.content.GatedContent
import id.petalytix.ayailmu.core.content.Item
import id.petalytix.ayailmu.core.model.AnswerEvent
import id.petalytix.ayailmu.core.model.Audience
import id.petalytix.ayailmu.core.model.ErrorTag
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.core.model.LocalizedText
import id.petalytix.ayailmu.core.model.Outcome
import id.petalytix.ayailmu.core.model.Pool
import id.petalytix.ayailmu.core.model.Response
import java.time.Instant
import java.time.ZoneId
import kotlin.random.Random

/**
 * Daily session state machine (Trial_App_Spec §4, §6; framework §4). Pure functions over a serialisable
 * state, so the state can be saved as a snapshot and resumed after a restart. Ported from the prototype;
 * additions: due reviews (ReviewScheduler), one hidden gem per session at an unpredictable position, casual
 * mode via RuleConfig, audience filtering, bilingual feedback.
 */
@kotlinx.serialization.Serializable
data class Step(
    val kind: Kind,
    val id: String,
    val role: Role = Role.PRACTICE,
) {
    @kotlinx.serialization.Serializable
    enum class Kind { SCREEN, ITEM }

    @kotlinx.serialization.Serializable
    enum class Role { PRACTICE, REVIEW, REMED, FOCUS, GEM }

    companion object {
        fun screen(id: String) = Step(Kind.SCREEN, id)

        fun item(
            id: String,
            role: Role,
        ) = Step(Kind.ITEM, id, role)
    }
}

@kotlinx.serialization.Serializable
data class FeedbackView(
    val itemId: String,
    val outcome: Outcome,
    val messages: List<String>,
)

@kotlinx.serialization.Serializable
data class StepResult(
    val itemId: String,
    val outcome: Outcome,
    val role: Step.Role,
)

@kotlinx.serialization.Serializable
data class SessionState(
    val version: Int = 1,
    val sessionId: String,
    val learnerId: String,
    val track: String,
    val lang: Lang,
    val audience: Audience?,
    val appVersion: String,
    val contentVersion: String,
    val rulesVersion: String,
    val startedAtEpochMs: Long,
    val zoneId: String,
    val localDate: String,
    val budgetMinutes: Int,
    val queue: List<Step>,
    val index: Int,
    val phase: Phase,
    val feedback: FeedbackView? = null,
    val results: List<StepResult> = emptyList(),
    /** Attempts made in this session (history is reloaded from storage between sessions). */
    val attempts: List<AttemptLog> = emptyList(),
    /** Skill whose serious mistake each queued focus question follows up. */
    val focusSkill: Map<String, String> = emptyMap(),
    val seenScreens: List<String> = emptyList(),
    val flags: List<String> = emptyList(),
) {
    @kotlinx.serialization.Serializable
    enum class Phase { STEP, FEEDBACK, DONE }

    val currentStep: Step? get() = if (phase == Phase.DONE) null else queue.getOrNull(index)
}

data class StartArgs(
    val content: GatedContent,
    val rules: RuleConfig,
    val history: List<AnswerEvent>,
    val learnerId: String,
    val lang: Lang,
    val audience: Audience?,
    val nowEpochMs: Long,
    val zone: ZoneId,
    val budgetMinutes: Int,
    val screensSeen: List<String>,
    val appVersion: String,
    val random: Random,
    val ids: IdGenerator = UuidIdGenerator,
)

data class Env(
    val content: GatedContent,
    val rules: RuleConfig,
    val history: List<AnswerEvent>,
    val nowEpochMs: Long,
    val timeOnItemMs: Long,
    val hintUsed: Boolean = false,
    val ids: IdGenerator = UuidIdGenerator,
    /** The learner used «Laporkan soal» on this item before answering (Trial_App_Spec §10 `report_flag`). */
    val reportFlag: Boolean = false,
)

data class SubmitResult(
    val state: SessionState,
    val event: AnswerEvent?,
)

object Session {
    fun start(a: StartArgs): SessionState {
        val today = Dates.localDate(a.nowEpochMs, a.zone)
        val queue = mutableListOf<Step>()
        a.content.screens
            .filter { it.screenId !in a.screensSeen && (it.audience == null || a.audience == null || it.audience == a.audience) }
            .forEach { queue += Step.screen(it.screenId) }

        // Planning estimate: about `items_per_minute` items per minute. The time budget still stops the session.
        val slots = maxOf(1, kotlin.math.round(a.budgetMinutes * a.rules.itemsPerMinute).toInt())
        val ctx = FreshContext(today, a.history.map { AttemptLog.of(it) }, a.rules, a.audience)

        // 1. Due reviews, capped (framework §4 step 2).
        val reviewCap = ReviewScheduler.cap(slots, a.rules)
        val reviews = ReviewScheduler.due(a.content.items, a.history, today, a.rules).take(reviewCap)
        reviews.forEach { queue += Step.item(it.itemId, Step.Role.REVIEW) }

        // 2. Fresh practice for the remaining slots.
        val picked = LinkedHashSet<String>()
        val practiceSlots = slots - reviews.size
        while (picked.size < practiceSlots) {
            val next = Freshness.pickFreshItem(a.content.items, ctx, setOf(Pool.PRACT), exclude = picked) ?: break
            picked += next.itemId
            queue += Step.item(next.itemId, Step.Role.PRACTICE)
        }

        // 3. One hidden gem at an unpredictable position among the item steps (framework §1b).
        val gem = Freshness.pickFreshItem(a.content.items, ctx, setOf(Pool.GEM), exclude = picked)
        if (gem != null) {
            val firstItem = queue.indexOfFirst { it.kind == Step.Kind.ITEM }.let { if (it < 0) queue.size else it }
            val at = if (queue.size > firstItem) firstItem + a.random.nextInt(queue.size - firstItem + 1) else queue.size
            queue.add(at, Step.item(gem.itemId, Step.Role.GEM))
        }

        return SessionState(
            sessionId = a.ids.newId("ses"),
            learnerId = a.learnerId,
            track = a.content.track,
            lang = a.lang,
            audience = a.audience,
            appVersion = a.appVersion,
            contentVersion = a.content.contentVersion,
            rulesVersion = a.rules.rulesVersion,
            startedAtEpochMs = a.nowEpochMs,
            zoneId = a.zone.id,
            localDate = today,
            budgetMinutes = a.budgetMinutes,
            queue = queue,
            index = 0,
            phase = if (queue.isEmpty()) SessionState.Phase.DONE else SessionState.Phase.STEP,
        )
    }

    // Both braces escaped: Android's ICU regex rejects a bare "}" that the JVM accepts (CR-KT-9).
    private val TEMPLATE = Regex("\\{(\\w+)\\}")

    private fun fill(
        template: String,
        vars: Map<String, String?>,
    ): String = TEMPLATE.replace(template) { m -> vars[m.groupValues[1]].orEmpty() }

    /**
     * Feedback lines for a scored item, with the pack's templates filled in ({model}, {benar}, ...). Shared by
     * sessions and by the practice-only modes (daily puzzle, speed round) that score without saving an event.
     */
    fun feedbackMessages(
        item: Item,
        feedbackIds: List<String>,
        templates: Map<String, LocalizedText>,
        lang: Lang,
    ): List<String> {
        val correctOption = item.options.firstOrNull { it.correct }?.let { it.text?.resolve(lang) ?: it.targetText }
        val vars =
            mapOf(
                "kalimat" to item.targetText,
                "model" to item.modelAnswer?.resolve(lang),
                "kata" to item.targetText,
                "makna" to item.wordMeaning?.resolve(lang),
                "benar" to correctOption,
            )
        return feedbackIds.mapNotNull { templates[it]?.resolve(lang) }.map { fill(it, vars) }
    }

    /**
     * Scores the current item and returns the new state plus one answer event. Returns event=null (and the
     * same state) if the current step is not an unanswered item, so a double tap never produces a second event.
     */
    fun submit(
        s: SessionState,
        response: Response,
        env: Env,
    ): SubmitResult {
        val step = s.currentStep
        if (s.phase != SessionState.Phase.STEP || step == null || step.kind != Step.Kind.ITEM) return SubmitResult(s, null)

        val item = env.content.item(step.id)
        val score = Scoring.scoreItem(item, response, env.rules, s.lang)
        val zone = ZoneId.of(s.zoneId)
        val today = Dates.localDate(env.nowEpochMs, zone)
        val seenBefore = env.history.any { it.itemId == item.itemId } || s.attempts.any { it.itemId == item.itemId }
        val focusSkill = if (step.role == Step.Role.FOCUS) s.focusSkill[item.itemId] else null
        val skills = if (focusSkill != null) listOf(focusSkill) else item.skills
        val evidenceCapable = item.type.evidenceCapable && item.pool != Pool.INSTR && item.pool != Pool.FOCUS && item.pool != Pool.GEM

        val event =
            AnswerEvent(
                answerId = env.ids.newId("ans"),
                learnerId = s.learnerId,
                itemId = item.itemId,
                track = s.track,
                contentVersion = item.contentVersion,
                rulesVersion = env.rules.rulesVersion,
                appVersion = s.appVersion,
                timestamp = Instant.ofEpochMilli(env.nowEpochMs).toString(),
                localDate = today,
                sessionId = s.sessionId,
                lang = s.lang,
                pool = item.pool,
                unit = item.unit,
                skills = skills,
                rawResponse = ContentJson.json.encodeToString(Response.serializer(), response),
                autoScore = score.parts,
                outcome = score.outcome,
                errorTags = score.errorTags,
                seriousTag = if (step.role == Step.Role.FOCUS) null else score.serious,
                hintUsed = env.hintUsed,
                helpLinesShown = item.helpLines.map { it.word },
                firstAttempt = !seenBefore,
                freshEvidence = !seenBefore && !env.hintUsed && evidenceCapable,
                timeOnItemMs = maxOf(0L, env.timeOnItemMs),
                audioStatus = response.audioStatus,
                reportFlag = env.reportFlag,
                reviewStatus = item.reviewStatus,
                synthetic = item.itemId.startsWith("DEMO-"),
                itemType = item.type,
                gem = item.gem,
            )

        // Follow-up after a mistake: focused question (serious only), then a fresh REMED item (CR-ENG-3).
        val attempts = s.attempts + AttemptLog.of(event)
        val inserts = mutableListOf<Step>()
        val focusMap = s.focusSkill.toMutableMap()
        val flags = s.flags.toMutableList()
        val primary = item.primarySkill
        if (step.role != Step.Role.FOCUS && score.outcome == Outcome.WRONG && !item.isMeaning && primary != null) {
            val seriousTag = score.serious
            if (seriousTag != null) {
                Freshness.pickFocusItem(env.content.items, seriousTag, item.referent)?.let { focus ->
                    inserts += Step.item(focus.itemId, Step.Role.FOCUS)
                    focusMap[focus.itemId] = primary
                }
            }
            val queued = s.queue.filter { it.kind == Step.Kind.ITEM }.map { it.id }.toSet()
            val ctx = FreshContext(today, env.history.map { AttemptLog.of(it) } + attempts, env.rules, s.audience)
            val remed = Freshness.pickFreshItem(env.content.items, ctx, setOf(Pool.REMED), skill = primary, exclude = queued)
            if (remed != null) {
                inserts += Step.item(remed.itemId, Step.Role.REMED)
            } else if ("out-of-fresh:$primary" !in flags) {
                flags += "out-of-fresh:$primary"
            }
        }

        val messages = feedbackMessages(item, score.feedbackIds, env.content.feedback, s.lang)

        val newQueue = s.queue.subList(0, s.index + 1) + inserts + s.queue.subList(s.index + 1, s.queue.size)
        return SubmitResult(
            state =
                s.copy(
                    queue = newQueue,
                    phase = SessionState.Phase.FEEDBACK,
                    feedback = FeedbackView(item.itemId, score.outcome, messages),
                    results = s.results + StepResult(item.itemId, score.outcome, step.role),
                    attempts = attempts,
                    focusSkill = focusMap,
                    flags = flags,
                ),
            event = event,
        )
    }

    /** Moves to the next step. Stops at the time budget, at the end of the current item. */
    fun advance(
        s: SessionState,
        nowEpochMs: Long,
    ): SessionState {
        val step = s.currentStep ?: return s
        if (step.kind == Step.Kind.ITEM && s.phase != SessionState.Phase.FEEDBACK) return s // must answer first
        val seenScreens =
            if (step.kind == Step.Kind.SCREEN && step.id !in s.seenScreens) s.seenScreens + step.id else s.seenScreens
        val index = s.index + 1
        val overBudget = step.kind == Step.Kind.ITEM && nowEpochMs - s.startedAtEpochMs >= s.budgetMinutes * 60_000L
        val done = index >= s.queue.size || overBudget
        return s.copy(index = index, seenScreens = seenScreens, phase = if (done) SessionState.Phase.DONE else SessionState.Phase.STEP, feedback = null)
    }

    data class OpenSerious(
        val skill: String,
        val tag: ErrorTag,
    )

    /** Serious mistakes still blocking "learned": need a correct focused question AND a correct fresh REMED item. */
    fun unresolvedSerious(history: List<AnswerEvent>): List<OpenSerious> {
        class Open(val tag: ErrorTag, var focus: Boolean = false, var remed: Boolean = false)
        val open = LinkedHashMap<String, Open>()
        for (r in history) {
            val skill = r.skills.firstOrNull() ?: continue
            val serious = r.seriousTag
            if (serious != null && r.pool != Pool.FOCUS) {
                open[skill] = Open(serious)
                continue
            }
            val o = open[skill] ?: continue
            if (r.outcome != Outcome.CORRECT) continue
            if (r.pool == Pool.FOCUS) o.focus = true
            if (r.pool == Pool.REMED && r.freshEvidence) o.remed = true
            if (o.focus && o.remed) open.remove(skill)
        }
        return open.map { (skill, o) -> OpenSerious(skill, o.tag) }
    }

    data class Summary(
        val answered: Int,
        val correct: Int,
        val wrong: Int,
        val pending: Int,
        val dontKnow: Int,
        val items: List<String>,
        val followUps: Int,
        val reviews: Int,
        val gems: Int,
        val minutes: Int,
        val nextReviewDate: String,
        val flags: List<String>,
    )

    /** Counts only. Deliberately makes no "learned"/mastery claim; that is SkillProjector's job. */
    fun summarize(
        s: SessionState,
        rules: RuleConfig,
        nowEpochMs: Long = s.startedAtEpochMs,
    ): Summary {
        val scored = s.results.filter { it.outcome != Outcome.NOT_ASSESSED }
        fun count(o: Outcome) = scored.count { it.outcome == o }
        return Summary(
            answered = scored.size,
            correct = count(Outcome.CORRECT),
            wrong = count(Outcome.WRONG),
            pending = count(Outcome.PENDING),
            dontKnow = count(Outcome.DONT_KNOW),
            items = scored.filter { it.role != Step.Role.FOCUS }.map { it.itemId }.distinct(),
            followUps = scored.count { it.role == Step.Role.REMED || it.role == Step.Role.FOCUS },
            reviews = scored.count { it.role == Step.Role.REVIEW },
            gems = s.results.count { it.role == Step.Role.GEM },
            minutes = maxOf(0, kotlin.math.round((nowEpochMs - s.startedAtEpochMs) / 60_000.0).toInt()),
            nextReviewDate = Dates.addDays(s.localDate, rules.reviewSpacingDays.first().toLong()),
            flags = s.flags,
        )
    }

    // ---- snapshots ------------------------------------------------------------------------------------

    fun encode(s: SessionState): String = ContentJson.json.encodeToString(SessionState.serializer(), s)

    /** Validates a stored snapshot against the current content; returns null if it cannot be resumed. */
    fun restore(
        raw: String?,
        content: GatedContent,
    ): SessionState? {
        if (raw.isNullOrBlank()) return null
        val s =
            try {
                ContentJson.json.decodeFromString(SessionState.serializer(), raw)
            } catch (e: Exception) {
                return null
            }
        if (s.version != 1 || s.contentVersion != content.contentVersion) return null
        val itemIds = content.items.map { it.itemId }.toSet()
        val screenIds = content.screens.map { it.screenId }.toSet()
        val ok = s.queue.all { if (it.kind == Step.Kind.ITEM) it.id in itemIds else it.id in screenIds }
        return if (ok) s else null
    }

    /** The item currently shown, or null on a screen / when done. */
    fun currentItem(
        s: SessionState,
        content: GatedContent,
    ): Item? = s.currentStep?.takeIf { it.kind == Step.Kind.ITEM }?.let { content.itemOrNull(it.id) }

    /** True when the session may still show a renderable step (used by the UI to skip v2-only content safely). */
    fun hasRenderableWork(
        s: SessionState,
        content: GatedContent,
    ): Boolean = s.queue.drop(s.index).any { it.kind == Step.Kind.SCREEN || content.itemOrNull(it.id)?.type?.isV1 == true }
}
