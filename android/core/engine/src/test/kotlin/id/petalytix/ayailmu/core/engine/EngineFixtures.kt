package id.petalytix.ayailmu.core.engine

import id.petalytix.ayailmu.core.content.ContentPack
import id.petalytix.ayailmu.core.content.GatedContent
import id.petalytix.ayailmu.core.content.Gating
import id.petalytix.ayailmu.core.content.Item
import id.petalytix.ayailmu.core.content.PackLoader
import id.petalytix.ayailmu.core.model.AnswerEvent
import id.petalytix.ayailmu.core.model.Audience
import id.petalytix.ayailmu.core.model.ItemType
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.core.model.Outcome
import id.petalytix.ayailmu.core.model.PartScore
import id.petalytix.ayailmu.core.model.Pool
import id.petalytix.ayailmu.core.model.ReviewStatus
import java.time.ZoneId
import java.time.ZonedDateTime
import kotlin.random.Random

/** Shared test helpers: bundled packs from the classpath, the Jakarta zone, deterministic ids. */
object EngineFixtures {
    val ZONE: ZoneId = ZoneId.of("Asia/Jakarta")

    /** 2026-10-15 09:00 Jakarta, the prototype tests' T0. */
    val T0: Long = ZonedDateTime.of(2026, 10, 15, 9, 0, 0, 0, ZONE).toInstant().toEpochMilli()

    private fun resource(path: String): String {
        val stream = EngineFixtures::class.java.classLoader.getResourceAsStream(path)
        requireNotNull(stream) { "missing test resource $path" }
        return stream.use { it.readBytes().toString(Charsets.UTF_8) }
    }

    val arabicPack: ContentPack by lazy { PackLoader.parse(resource("packs/bahasa/arab/v1.json")) }
    /** Frozen copy of the P1 math sample (src/test/resources/fixtures); the bundled kids pack keeps growing. */
    val mathPack: ContentPack by lazy { PackLoader.parse(resource("fixtures/mat-sample-v1.json")) }
    /** Follow-up 11 sample: trace, gestures, picture audio_match (src/test/resources/fixtures). */
    val langPack: ContentPack by lazy { PackLoader.parse(resource("fixtures/lang-sample-v1.json")) }
    val arabicRules: RuleConfig by lazy { RuleConfig.parse(resource("config/rules.arab.json")) }
    val mathRules: RuleConfig by lazy { RuleConfig.parse(resource("config/rules.mat.json")) }

    val arabic: GatedContent by lazy { Gating.gate(arabicPack, developerDemo = true) }
    val math: GatedContent by lazy { Gating.gate(mathPack, developerDemo = true) }
    val lang: GatedContent by lazy { Gating.gate(langPack, developerDemo = true) }

    fun item(id: String): Item = arabic.item(id)

    fun attempt(
        itemId: String,
        localDate: String,
        pool: Pool? = null,
        skills: List<String>? = null,
    ): AttemptLog {
        val it = arabic.itemOrNull(itemId)
        return AttemptLog(
            itemId = itemId,
            localDate = localDate,
            pool = pool ?: it?.pool ?: Pool.PRACT,
            skills = skills ?: it?.skills ?: emptyList(),
            unit = it?.unit ?: "A",
            firstAttempt = true,
            hintUsed = false,
        )
    }

    fun startArabic(
        history: List<AnswerEvent> = emptyList(),
        screensSeen: List<String> = emptyList(),
        minutes: Int = 15,
        ids: IdGenerator = CountingIdGenerator(),
    ): SessionState =
        Session.start(
            StartArgs(
                content = arabic,
                rules = arabicRules,
                history = history,
                learnerId = "lrn-1",
                lang = Lang.ID,
                audience = Audience.ADULTS,
                nowEpochMs = T0,
                zone = ZONE,
                budgetMinutes = minutes,
                screensSeen = screensSeen,
                appVersion = "0.1.0",
                random = Random(1),
                ids = ids,
            ),
        )

    fun env(
        history: List<AnswerEvent> = emptyList(),
        now: Long = T0,
        timeOnItemMs: Long = 1,
        hintUsed: Boolean = false,
        ids: IdGenerator = CountingIdGenerator(),
    ) = Env(arabic, arabicRules, history, now, timeOnItemMs, hintUsed, ids)

    /** A minimal synthetic event for projector/scheduler tests. */
    fun event(
        itemId: String,
        localDate: String,
        outcome: Outcome,
        skills: List<String> = listOf("NOM-01"),
        pool: Pool = Pool.PRACT,
        type: ItemType = ItemType.TYPE_IN,
        fresh: Boolean = true,
        first: Boolean = true,
        timestamp: String = "${localDate}T02:00:00Z",
        serious: id.petalytix.ayailmu.core.model.ErrorTag? = null,
    ) = AnswerEvent(
        answerId = "a-$itemId-$localDate-$timestamp",
        learnerId = "lrn-1",
        itemId = itemId,
        track = "arab",
        contentVersion = "demo-synthetic-0.1",
        rulesVersion = "pilot-0.1",
        appVersion = "0.1.0",
        timestamp = timestamp,
        localDate = localDate,
        sessionId = "ses-x",
        lang = Lang.ID,
        pool = pool,
        unit = "A",
        skills = skills,
        rawResponse = "{}",
        autoScore = mapOf("answer" to PartScore.CORRECT),
        outcome = outcome,
        seriousTag = serious,
        firstAttempt = first,
        freshEvidence = fresh,
        reviewStatus = ReviewStatus.DRAFT,
        itemType = type,
    )
}
