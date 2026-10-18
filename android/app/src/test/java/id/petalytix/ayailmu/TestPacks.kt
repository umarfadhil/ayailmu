package id.petalytix.ayailmu

import id.petalytix.ayailmu.core.content.ContentJson
import id.petalytix.ayailmu.core.content.ContentPack
import id.petalytix.ayailmu.core.content.GatedContent
import id.petalytix.ayailmu.core.content.Gating
import id.petalytix.ayailmu.core.content.PackLoader
import id.petalytix.ayailmu.core.data.Profile
import id.petalytix.ayailmu.core.data.ProfileKind
import id.petalytix.ayailmu.core.data.repo.ContentCatalog
import id.petalytix.ayailmu.core.data.repo.LoadedTrack
import id.petalytix.ayailmu.core.engine.CountingIdGenerator
import id.petalytix.ayailmu.core.engine.Env
import id.petalytix.ayailmu.core.engine.RuleConfig
import id.petalytix.ayailmu.core.engine.Session
import id.petalytix.ayailmu.core.engine.SessionState
import id.petalytix.ayailmu.core.engine.SessionStore
import id.petalytix.ayailmu.core.engine.StartArgs
import id.petalytix.ayailmu.core.engine.Step
import id.petalytix.ayailmu.core.model.AnswerEvent
import id.petalytix.ayailmu.core.model.Audience
import id.petalytix.ayailmu.core.model.ItemType
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.core.model.Response
import id.petalytix.ayailmu.feature.session.SessionContent
import java.time.Instant
import java.time.ZoneId
import kotlin.random.Random

/** Real bundled packs for app tests (content/src/main/assets is a test resource dir, see app/build.gradle.kts). */
object TestPacks {
    data class Track(
        val pack: ContentPack,
        val rules: RuleConfig,
        val content: GatedContent,
    )

    private fun read(path: String): String {
        val stream = requireNotNull(TestPacks::class.java.classLoader!!.getResourceAsStream(path)) { "missing test asset $path" }
        return stream.use { it.readBytes().decodeToString() }
    }

    private fun load(
        pack: String,
        rules: String,
    ): Track {
        val p = PackLoader.parse(read(pack))
        return Track(p, RuleConfig.parse(read(rules)), SessionContent.playable(Gating.gate(p, developerDemo = true)))
    }

    /** Every track in the bundled catalog as the app loads it (demo gating, the catalog's free units). */
    val catalog: List<LoadedTrack> by lazy {
        val c = ContentJson.json.decodeFromString(ContentCatalog.serializer(), read("config/catalog.json"))
        c.tracks.map { e ->
            val p = PackLoader.parse(read(e.pack))
            LoadedTrack(e.track, p, RuleConfig.parse(read(e.rules)), Gating.gate(p, developerDemo = true), emptyList(), e.freeUnits)
        }
    }

    fun track(id: String): LoadedTrack = catalog.first { it.track == id }

    /** Frozen copy of the P1 math sample (src/test/resources/fixtures); the bundled kids pack keeps growing. */
    val math: Track by lazy { load("fixtures/mat-sample-v1.json", "config/rules.mat.json") }
    val arabic: Track by lazy { load("packs/bahasa/arab/v1.json", "config/rules.arab.json") }

    fun profile(
        id: String = "lrn-kid",
        kind: ProfileKind = ProfileKind.ANAK,
        lang: Lang = Lang.ID,
        screensSeen: List<String> = emptyList(),
    ) = Profile(
        id = id,
        label = if (kind == ProfileKind.ANAK) "Sari" else "Umar",
        kind = kind,
        createdBy = if (kind == ProfileKind.ANAK) "lrn-adult" else null,
        birthYear = if (kind == ProfileKind.ANAK) 2017 else 1990,
        audience = if (kind == ProfileKind.ANAK) Audience.KIDS else Audience.ADULTS,
        lang = lang,
        createdAtMs = 0L,
        sessionMinutes = null,
        arabicScale = 1f,
        screensSeen = screensSeen,
        consentVersion = null,
    )

    /**
     * Plays one whole session on the real engine, answering "I don't know yet" to every question (gems are
     * "seen"), and returns the answer events it produced.
     */
    fun playDontKnow(
        track: Track,
        profile: Profile,
        history: List<AnswerEvent> = emptyList(),
        now: Instant = Instant.parse("2026-10-17T02:00:00Z"),
    ): List<AnswerEvent> {
        val zone = ZoneId.of("Asia/Jakarta")
        val ids = CountingIdGenerator()
        var s =
            Session.start(
                StartArgs(
                    content = track.content,
                    rules = track.rules,
                    history = history,
                    learnerId = profile.id,
                    lang = profile.lang,
                    audience = profile.audience,
                    nowEpochMs = now.toEpochMilli(),
                    zone = zone,
                    budgetMinutes = 10,
                    screensSeen = emptyList(),
                    appVersion = "test",
                    random = Random(1),
                    ids = ids,
                ),
            )
        val events = mutableListOf<AnswerEvent>()
        while (s.phase != SessionState.Phase.DONE) {
            val step = requireNotNull(s.currentStep)
            if (step.kind == Step.Kind.ITEM && s.phase == SessionState.Phase.STEP) {
                val item = track.content.item(step.id)
                val gemCard = item.type == ItemType.INFO_CARD || item.type == ItemType.MINI_READING
                val r = Session.submit(s, if (gemCard) Response.choice("seen") else Response.dontKnow(), Env(track.content, track.rules, history + events, now.toEpochMilli(), 1_000L, ids = ids))
                events += requireNotNull(r.event)
                s = r.state
            } else {
                s = Session.advance(s, now.toEpochMilli())
            }
        }
        return events
    }

    /** A state whose current step is [itemId] (for mapping one item at a time). */
    fun stateAt(
        itemId: String,
        track: String,
        lang: Lang = Lang.ID,
        role: Step.Role = Step.Role.PRACTICE,
    ) = SessionState(
        sessionId = "ses-1",
        learnerId = "lrn-1",
        track = track,
        lang = lang,
        audience = null,
        appVersion = "test",
        contentVersion = "test",
        rulesVersion = "test",
        startedAtEpochMs = 0L,
        zoneId = "Asia/Jakarta",
        localDate = "2026-10-17",
        budgetMinutes = 10,
        queue = listOf(Step.item(itemId, role)),
        index = 0,
        phase = SessionState.Phase.STEP,
    )
}

/** In-memory SessionStore with an injectable write failure. */
class MemoryStore : SessionStore {
    val events = mutableListOf<AnswerEvent>()
    var snapshot: SessionState? = null
    var screens: List<String> = emptyList()
    var failNextAnswer = false

    override suspend fun recordAnswer(
        event: AnswerEvent,
        snapshot: SessionState,
    ) {
        if (failNextAnswer) {
            failNextAnswer = false
            error("disk full")
        }
        events += event
        this.snapshot = snapshot
    }

    override suspend fun saveSnapshot(snapshot: SessionState) {
        this.snapshot = snapshot
    }

    override suspend fun saveScreensSeen(screenIds: List<String>) {
        screens = screenIds
    }
}
