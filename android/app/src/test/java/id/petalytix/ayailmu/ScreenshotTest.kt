package id.petalytix.ayailmu

import android.app.Application
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.Density
import com.github.takahirom.roborazzi.captureRoboImage
import id.petalytix.ayailmu.core.billing.Product
import id.petalytix.ayailmu.core.content.Gestures
import id.petalytix.ayailmu.core.content.StrokeGlyph
import id.petalytix.ayailmu.core.content.StrokeIndex
import id.petalytix.ayailmu.core.data.Profile
import id.petalytix.ayailmu.core.data.ProfileKind
import id.petalytix.ayailmu.core.data.settings.ReminderSetting
import id.petalytix.ayailmu.core.design.components.PaperBackground
import id.petalytix.ayailmu.core.design.sound.LocalVoice
import id.petalytix.ayailmu.core.design.sound.VoicePlayer
import id.petalytix.ayailmu.core.design.theme.AyaSpacing
import id.petalytix.ayailmu.core.design.theme.AyaTheme
import id.petalytix.ayailmu.core.engine.FeedbackView
import id.petalytix.ayailmu.core.engine.Session
import id.petalytix.ayailmu.core.engine.SessionState
import id.petalytix.ayailmu.core.engine.Step
import id.petalytix.ayailmu.core.model.Audience
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.core.model.Outcome
import id.petalytix.ayailmu.core.model.Subject
import id.petalytix.ayailmu.core.model.TrackMode
import id.petalytix.ayailmu.feature.collection.CollectionUiState
import id.petalytix.ayailmu.feature.collection.FigureUi
import id.petalytix.ayailmu.feature.collection.FiguresScreen
import id.petalytix.ayailmu.feature.collection.FiguresUiState
import id.petalytix.ayailmu.feature.collection.GemBoxScreen
import id.petalytix.ayailmu.feature.collection.StickerShelf
import id.petalytix.ayailmu.feature.collection.StickerShelfScreen
import id.petalytix.ayailmu.feature.collection.StickerUi
import id.petalytix.ayailmu.feature.consent.ConsentScreen
import id.petalytix.ayailmu.feature.consent.ConsentUiState
import id.petalytix.ayailmu.feature.home.HomeNav
import id.petalytix.ayailmu.feature.home.HomeScreen
import id.petalytix.ayailmu.feature.home.previewHomeState
import id.petalytix.ayailmu.feature.onboarding.OnboardingScreen
import id.petalytix.ayailmu.feature.onboarding.OnboardingStep
import id.petalytix.ayailmu.feature.onboarding.OnboardingUiState
import id.petalytix.ayailmu.feature.progress.Count
import id.petalytix.ayailmu.feature.progress.ProgressData
import id.petalytix.ayailmu.feature.progress.ProgressNav
import id.petalytix.ayailmu.feature.progress.ProgressScreen
import id.petalytix.ayailmu.feature.progress.ProgressSummary
import id.petalytix.ayailmu.feature.progress.ProgressUiState
import id.petalytix.ayailmu.feature.puzzle.DailyPuzzleScreen
import id.petalytix.ayailmu.feature.puzzle.PuzzleUiState
import id.petalytix.ayailmu.feature.session.HelpUi
import id.petalytix.ayailmu.feature.session.MemoryCardUi
import id.petalytix.ayailmu.feature.session.OptionUi
import id.petalytix.ayailmu.feature.session.RegionUi
import id.petalytix.ayailmu.feature.session.RenderKind
import id.petalytix.ayailmu.feature.session.SessionScreen
import id.petalytix.ayailmu.feature.session.SessionUiState
import id.petalytix.ayailmu.feature.session.SliderUi
import id.petalytix.ayailmu.feature.session.StepUi
import id.petalytix.ayailmu.feature.session.TargetStyle
import id.petalytix.ayailmu.feature.session.interact.LocalStrokes
import id.petalytix.ayailmu.feature.session.story.PreviewStory
import id.petalytix.ayailmu.feature.session.story.StoryPlayer
import id.petalytix.ayailmu.feature.session.story.StoryTimeline
import id.petalytix.ayailmu.feature.settings.SettingsData
import id.petalytix.ayailmu.feature.settings.SettingsScreen
import id.petalytix.ayailmu.feature.settings.SettingsUiState
import id.petalytix.ayailmu.feature.speedround.SpeedRoundScreen
import id.petalytix.ayailmu.feature.speedround.SpeedUiState
import id.petalytix.ayailmu.feature.store.AdultGate
import id.petalytix.ayailmu.feature.store.StoreData
import id.petalytix.ayailmu.feature.store.StoreItem
import id.petalytix.ayailmu.feature.store.StoreScreen
import id.petalytix.ayailmu.feature.store.StoreUiState
import id.petalytix.ayailmu.feature.trial.SurveyKind
import id.petalytix.ayailmu.feature.trial.SurveyScreen
import id.petalytix.ayailmu.feature.trial.SurveyUiState
import id.petalytix.ayailmu.feature.units.ChallengeUiState
import id.petalytix.ayailmu.feature.units.PlayQuestion
import id.petalytix.ayailmu.feature.units.UnitChallengeScreen
import id.petalytix.ayailmu.feature.units.UnitRow
import id.petalytix.ayailmu.feature.units.UnitsData
import id.petalytix.ayailmu.feature.units.UnitsNav
import id.petalytix.ayailmu.feature.units.UnitsScreen
import id.petalytix.ayailmu.feature.units.UnitsUiState
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Screenshot tests (CR-I18N-6, CR-REL-3): every P3–P6 screen in Indonesian/light, English/dark and Indonesian at
 * font scale 1.5 — one subclass per variant below, so the language comes from Robolectric's resource
 * qualifiers ("in" falls back to values/, which is Indonesian). Plain `testDemoDebugUnitTest` only renders them
 * (catching crashes); baselines are written with `:app:recordRoborazziDemoDebug` and checked with
 * `:app:verifyRoborazziDemoDebug`. A plain Application is used so Hilt and the real database are not started.
 * Placeholder art (P4) will change these images on purpose. Excluded from release unit-test tasks (the Compose
 * test activity is debug-only).
 */
abstract class ScreenshotTest(
    private val variant: String,
    private val dark: Boolean,
    private val fontScale: Float,
) {
    @get:Rule
    val compose = createComposeRule()

    private fun shot(
        screen: String,
        content: @Composable () -> Unit,
    ) {
        compose.setContent {
            // Font scale through density: Compose turns sp into pixels with LocalDensity.fontScale.
            CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density, fontScale)) {
                AyaTheme(darkTheme = dark) { PaperBackground { content() } }
            }
        }
        compose.onRoot().captureRoboImage("src/test/screenshots/${screen}_$variant.png")
    }

    @Test
    fun onboardingLanguage() = shot("onboarding_language") { OnboardingScreen(OnboardingUiState(loading = false, years = YEARS), onEvent = {}, onCancel = null) }

    @Test
    fun onboardingAge() =
        shot("onboarding_age") {
            OnboardingScreen(OnboardingUiState(loading = false, step = OnboardingStep.AGE, years = YEARS), onEvent = {}, onCancel = {})
        }

    @Test
    fun home() = shot("home") { HomeScreen(state = previewHomeState, onEvent = {}, nav = HomeNav()) }

    @Test
    fun sessionChoice() = shot("session_choice") { SessionScreen(state = CHOICE, onEvent = {}, onClose = {}, onExit = {}) }

    @Test
    fun sessionFeedback() = shot("session_feedback") { SessionScreen(state = FEEDBACK, onEvent = {}, onClose = {}, onExit = {}) }

    @Test
    fun sessionSummary() = shot("session_summary") { SessionScreen(state = SUMMARY, onEvent = {}, onClose = {}, onExit = {}) }

    @Test
    fun progress() = shot("progress") { ProgressScreen(state = ProgressUiState.Ready(ProgressData("Bahasa Arab — Unit A", PROGRESS)), nav = ProgressNav()) }

    // ---- P4–P6 screens (draft art; baselines change when the illustrator's set lands) ----

    @Test
    fun sessionPictureChoice() = shot("session_picture_choice") { SessionScreen(state = CHOICE.copy(step = PICTURES), onEvent = {}, onClose = {}, onExit = {}) }

    @Test
    fun sessionHotspot() = shot("session_hotspot") { SessionScreen(state = CHOICE.copy(step = HOTSPOT), onEvent = {}, onClose = {}, onExit = {}) }

    @Test
    fun sessionSlider() = shot("session_slider") { SessionScreen(state = CHOICE.copy(step = SLIDER), onEvent = {}, onClose = {}, onExit = {}) }

    @Test
    fun sessionMemory() = shot("session_memory") { SessionScreen(state = CHOICE.copy(step = MEMORY), onEvent = {}, onClose = {}, onExit = {}) }

    // ---- follow-up 11 renderers (connect, drag, baskets, slots, listen, trace) ----

    private fun session(step: StepUi.Question) = CHOICE.copy(step = step)

    @Test
    fun sessionConnect() =
        shot("session_connect") { SessionScreen(state = session(CONNECT), onEvent = {}, onClose = {}, onExit = {}) }

    @Test
    fun sessionDragPairs() =
        shot("session_drag_pairs") {
            SessionScreen(state = session(CONNECT.copy(gesture = Gestures.DRAG)), onEvent = {}, onClose = {}, onExit = {})
        }

    @Test
    fun sessionBuckets() =
        shot("session_buckets") { SessionScreen(state = session(BUCKETS), onEvent = {}, onClose = {}, onExit = {}) }

    @Test
    fun sessionSequenceDrag() =
        shot("session_sequence_drag") { SessionScreen(state = session(ORDER_DRAG), onEvent = {}, onClose = {}, onExit = {}) }

    @Test
    fun sessionFillBlankDrag() =
        shot("session_fill_blank_drag") { SessionScreen(state = session(FILL_DRAG), onEvent = {}, onClose = {}, onExit = {}) }

    @Test
    fun sessionListen() =
        shot("session_listen") {
            CompositionLocalProvider(LocalVoice provides EveryClip) {
                SessionScreen(state = session(LISTEN), onEvent = {}, onClose = {}, onExit = {})
            }
        }

    @Test
    fun sessionTrace() =
        shot("session_trace") {
            CompositionLocalProvider(LocalStrokes provides STROKES, LocalVoice provides EveryClip) {
                SessionScreen(state = session(TRACE), onEvent = {}, onClose = {}, onExit = {})
            }
        }

    @Test
    fun sessionTraceNoStrokes() =
        shot("session_trace_no_strokes") { SessionScreen(state = session(TRACE), onEvent = {}, onClose = {}, onExit = {}) }

    // ---- follow-up 12 stories (draft hist_ art; keys without a drawing show dashed frames) ----

    /** A story item in a session: first panel, entrances run to their end, loops at rest (tests hold them). */
    @Test
    fun storyFirstPanel() =
        shot("story_first_panel") {
            CompositionLocalProvider(LocalVoice provides EveryClip) {
                SessionScreen(state = session(STORY), onEvent = {}, onClose = {}, onExit = {})
            }
        }

    /** The player on its second panel with its own controls (the «Lihat cerita lagi» dialog and the gallery). */
    @Test
    fun storyMidPanel() =
        shot("story_mid_panel") {
            CompositionLocalProvider(LocalVoice provides EveryClip) {
                Page { StoryPlayer(PreviewStory, StoryTimeline.start(PreviewStory.panels.size).next(), onTimeline = {}, controls = true) }
            }
        }

    /** Reduce-motion: every layer at its final pose, no scene zoom, no crossfade. */
    @Test
    fun storyReduceMotion() =
        shot("story_reduce_motion") {
            Page {
                StoryPlayer(PreviewStory, StoryTimeline.start(PreviewStory.panels.size), onTimeline = {}, controls = true, reduceMotion = true)
            }
        }

    /** The player as the dialog shows it: a scrolling page with a margin. */
    @Composable
    private fun Page(content: @Composable () -> Unit) {
        Column(modifier = Modifier.verticalScroll(rememberScrollState()).padding(AyaSpacing.md)) { content() }
    }

    /** A question about a story: the small «Lihat cerita lagi» button above it. */
    @Test
    fun storyQuestion() =
        shot("story_question") {
            val question = PICTURES.copy(prompt = "Apa yang Kartini tulis?", story = PreviewStory)
            SessionScreen(state = session(question), onEvent = {}, onClose = {}, onExit = {})
        }

    @Test
    fun figures() = shot("figures") { FiguresScreen(state = FiguresUiState.Ready(FIGURES), onBack = {}) }

    @Test
    fun figuresEmpty() = shot("figures_empty") { FiguresScreen(state = FiguresUiState.Ready(emptyList()), onBack = {}) }

    @Test
    fun sessionNothingToday() = shot("session_nothing_today") { SessionScreen(state = SessionUiState.NothingToday, onEvent = {}, onClose = {}, onExit = {}) }

    @Test
    fun store() = shot("store") { StoreScreen(state = STORE, onEvent = {}, onBuy = {}, onBack = {}) }

    @Test
    fun storeGate() = shot("store_gate") { StoreScreen(state = STORE.copy(gate = AdultGate(7, 8)), onEvent = {}, onBuy = {}, onBack = {}) }

    @Test
    fun dailyPuzzle() =
        shot("daily_puzzle") {
            DailyPuzzleScreen(state = PuzzleUiState.Ready("Matematika — Pemula (Anak)", PICTURES, TargetStyle()), onAnswer = {}, onBack = {})
        }

    @Test
    fun speedRound() =
        shot("speed_round") {
            SpeedRoundScreen(state = SpeedUiState.Running(CHOICE.step as StepUi.Question, TargetStyle(), 3, 10, 0.6f), onAnswer = {}, onSkip = {}, onBack = {})
        }

    @Test
    fun stickers() = shot("stickers") { StickerShelfScreen(state = CollectionUiState.Ready(listOf(SHELF)), onBack = {}) }

    @Test
    fun gems() = shot("gems") { GemBoxScreen(state = CollectionUiState.Ready(emptyList()), onBack = {}) }

    @Test
    fun settings() = shot("settings") { SettingsScreen(state = SettingsUiState(loading = false, data = SETTINGS), onEvent = {}, onBack = {}) }

    @Test
    fun consent() = shot("consent") { ConsentScreen(state = ConsentUiState(track = "arab"), onEvent = {}, onBack = {}) }

    @Test
    fun units() = shot("units") { UnitsScreen(state = UnitsUiState.Ready(UNITS), nav = UnitsNav()) }

    @Test
    fun unitChallenge() =
        shot("unit_challenge") {
            UnitChallengeScreen(
                state = ChallengeUiState.Running("Bilangan sampai 100", "01", PlayQuestion(CHOICE.step as StepUi.Question, TargetStyle()), 2, 5),
                onAnswer = {},
                onNext = {},
                onBack = {},
            )
        }

    @Test
    fun surveyBackground() =
        shot("survey_background") {
            SurveyScreen(state = SurveyUiState(kind = SurveyKind.BACKGROUND, loading = false, answers = mapOf("e_b1" to listOf("tpa"))), onEvent = {})
        }

    companion object {
        private val YEARS = (2026 downTo 1926).toList()

        private val CHOICE =
            SessionUiState.Running(
                step =
                    StepUi.Question(
                        itemId = "MAT-K-P-01-010",
                        kind = RenderKind.CHOICE,
                        role = Step.Role.PRACTICE,
                        prompt = "Mana yang lebih besar?",
                        target = null,
                        help = emptyList(),
                        options = listOf(OptionUi("a", "17", null, null), OptionUi("b", "71", null, null)),
                    ),
                phase = SessionState.Phase.STEP,
                feedback = null,
                position = 3,
                total = 10,
                draft = true,
            )

        private val FEEDBACK =
            CHOICE.copy(
                step =
                    StepUi.Question(
                        itemId = "DEMO-P01",
                        kind = RenderKind.PARAPHRASE,
                        role = Step.Role.PRACTICE,
                        prompt = "Apa arti kalimat ini?",
                        target = "هِيَ مُؤْمِنَةٌ",
                        help = emptyList(),
                    ),
                phase = SessionState.Phase.FEEDBACK,
                feedback = FeedbackView("DEMO-P01", Outcome.PENDING, listOf("Jawaban Anda kami simpan untuk dicek.")),
            )

        private fun q(
            kind: RenderKind,
            prompt: String,
        ) = StepUi.Question(itemId = "X", kind = kind, role = Step.Role.PRACTICE, prompt = prompt, target = null, help = emptyList())

        private val PICTURES =
            q(RenderKind.CHOICE, "Mana yang 9 mangga?").copy(
                options = listOf(9, 12, 15).map { OptionUi("o$it", "$it", null, "count_mango_$it") },
            )

        private val HOTSPOT =
            q(RenderKind.HOTSPOT, "Ketuk yang berbentuk segitiga.").copy(
                image = "scene_kampung_shapes",
                options =
                    listOf(
                        OptionUi("sun", "matahari", null, null, RegionUi(0.06f, 0.06f, 0.18f, 0.24f)),
                        OptionUi("roof", "atap", null, null, RegionUi(0.30f, 0.20f, 0.36f, 0.22f)),
                        OptionUi("kite", "layang-layang", null, null, RegionUi(0.74f, 0.06f, 0.16f, 0.26f)),
                    ),
            )

        private val SLIDER = q(RenderKind.SLIDER, "Kira-kira berapa jam dalam satu tahun?").copy(slider = SliderUi(0.0, 20_000.0, 100.0), unitLabel = "jam")

        private val MEMORY =
            q(RenderKind.MEMORY, "Cocokkan pasangannya.").let { base ->
                val pairs = listOf("2" to "dua", "5" to "lima", "7" to "tujuh")
                val left = pairs.map { OptionUi("n${it.first}", it.first, null, null) }
                val right = pairs.map { OptionUi("w${it.first}", it.second, null, null) }
                base.copy(
                    left = left,
                    right = right,
                    cards =
                        (left.map { MemoryCardUi("L-${it.id}", it, it.id, left = true) } + right.map { MemoryCardUi("R-${it.id}", it, "n" + it.id.drop(1), left = false) })
                            .shuffled(kotlin.random.Random(3)),
                )
            }

        /** Every clip "exists" so speaker and listen buttons show; nothing plays under Robolectric. */
        private object EveryClip : VoicePlayer {
            override fun has(clip: String): Boolean = true

            override fun play(clip: String) = Unit

            override fun stop() = Unit
        }

        private val CONNECT =
            q(RenderKind.PAIRS, "Pasangkan gambar dan katanya.").copy(
                gesture = Gestures.CONNECT,
                left = listOf("mango", "banana", "papaya").map { OptionUi("p_$it", null, null, "fruit_$it") },
                right =
                    listOf("pisang" to "banana", "pepaya" to "papaya", "mangga" to "mango").map { (word, id) ->
                        OptionUi("w_$id", word, null, null)
                    },
            )

        private val BUCKETS =
            q(RenderKind.BUCKETS, "Punya sudut atau tidak?").copy(
                gesture = Gestures.DRAG,
                left = listOf("triangle", "circle", "square", "oval").map { OptionUi("s_$it", null, null, "shape_$it") },
                right = listOf(OptionUi("b_yes", "Punya sudut", null, null), OptionUi("b_no", "Tidak punya sudut", null, null)),
            )

        private val ORDER_DRAG =
            q(RenderKind.SEQUENCE, "Urutkan dari yang terkecil.").copy(
                gesture = Gestures.DRAG,
                options = listOf(56, 29, 65, 31).map { OptionUi("n$it", "$it", null, null) },
                slots = 4,
            )

        private val FILL_DRAG =
            q(RenderKind.SEQUENCE, "Isi bagian yang kosong.").copy(
                gesture = Gestures.DRAG,
                help = listOf(HelpUi(null, "Kita berpikir, belajar, dan mengingat dengan ____.")),
                blankLine = 0,
                options = listOf("lambung", "otak", "paru-paru").map { OptionUi("t_$it", it, null, null) },
                slots = 1,
            )

        private val LISTEN =
            q(RenderKind.CHOICE, "Dengar, lalu pilih.").copy(
                listen = true,
                audio = "ko/sagwa",
                targetLang = "ko",
                options = listOf("mango", "banana", "papaya", "rambutan").map { OptionUi("o_$it", null, null, "fruit_$it") },
            )

        private val TRACE =
            q(RenderKind.TRACE, "Tulis hurufnya.").copy(
                target = "ㄱ",
                romanization = "g / k",
                audio = "ko/giyeok",
                trace = "hangul_g",
                targetLang = "ko",
            )

        private val STORY = q(RenderKind.STORY, "Tonton ceritanya.").copy(story = PreviewStory)

        private fun figure(
            id: String,
            name: String,
            emblem: String,
        ) = PreviewStory.copy(storyId = id, figure = name, emblem = emblem)

        private val FIGURES =
            listOf(
                FigureUi(PreviewStory, met = true),
                FigureUi(figure("ST-SARTIKA", "Dewi Sartika (1884–1947)", "hist_sewing_kit"), met = true),
                FigureUi(figure("ST-ZHENG-HE", "Zheng He (1371–1433)", "hist_treasure_ship"), met = false),
            )

        private val STROKES =
            StrokeIndex(
                mapOf(
                    "hangul_g" to
                        StrokeGlyph(
                            glyph = "ㄱ",
                            script = "hangul",
                            strokes = listOf(listOf(listOf(0.25, 0.28), listOf(0.72, 0.28), listOf(0.70, 0.52), listOf(0.62, 0.78))),
                        ),
                ),
            )

        private val STORE =
            StoreUiState(
                data =
                    StoreData(
                        items =
                            listOf(
                                StoreItem(Product.ALL_ACCESS, "Rp 149.000", owned = false, pending = false),
                                StoreItem(Product.PACK_BAHASA, "Rp 79.000", owned = false, pending = true),
                                StoreItem(Product.PACK_MATEMATIKA, "Rp 59.000", owned = true, pending = false),
                                StoreItem(Product.PACK_SAINS, "Rp 59.000", owned = false, pending = false),
                                StoreItem(Product.PACK_SOSIAL_SENI, "Rp 59.000", owned = false, pending = false),
                            ),
                        pricesAvailable = true,
                        childProfile = false,
                        demo = false,
                        unlockAll = false,
                    ),
            )

        private val SHELF =
            StickerShelf(
                "Matematika — Pemula (Anak)",
                listOf("mango", "kite", "angklung", "bicycle", "teapot").mapIndexed { i, k ->
                    StickerUi("0${i + 1}", "Unit ${i + 1}", "sticker_$k", earned = i < 2)
                },
            )

        private val UNITS =
            UnitsData(
                trackTitle = "Matematika — Pemula (Anak)",
                subject = Subject.MATEMATIKA,
                rows =
                    listOf(
                        UnitRow("01", "Bilangan sampai 100", "sticker_mango", locked = false, answered = 11, total = 11, challengeDone = true),
                        UnitRow("02", "Penjumlahan", "sticker_shell", locked = false, answered = 11, total = 11, challengeDone = false),
                        UnitRow("03", "Pengurangan", "sticker_kite", locked = true, answered = 0, total = 11, challengeDone = false),
                    ),
                lockedBy = Product.PACK_MATEMATIKA,
            )

        private val SUMMARY = SessionUiState.Done(Session.Summary(9, 6, 2, 0, 1, emptyList(), 1, 0, 1, 8, "2026-10-18", emptyList()))

        private val PROGRESS =
            ProgressSummary(
                mode = TrackMode.EVIDENCE,
                learned = Count(3, 9),
                remembered = Count(2, 3),
                newSentences = Count(0, 0),
                words = Count(4, 12),
                practicing = 5,
                needsFollowUp = 1,
                waitingForCheck = 2,
                gems = 1,
                daysPracticed = 6,
            )

        private val SETTINGS =
            SettingsData(
                profile =
                    Profile(
                        id = "lrn-6f1c2a9e",
                        label = "Umar",
                        kind = ProfileKind.ADULT,
                        createdBy = null,
                        birthYear = 1990,
                        audience = Audience.ADULTS,
                        lang = Lang.ID,
                        createdAtMs = 0L,
                        sessionMinutes = 15,
                        arabicScale = 1.2f,
                        screensSeen = emptyList(),
                        consentVersion = "arab-trial-1",
                    ),
                sessionOptions = listOf(10, 15, 20),
                showArabicSize = true,
                reminder = ReminderSetting(enabled = true, hour = 19, minute = 30),
                appVersion = "0.1.0-demo",
            )
    }
}

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], application = Application::class, qualifiers = "in-w360dp-h800dp-xhdpi")
class ScreenshotIdLightTest : ScreenshotTest("id_light", dark = false, fontScale = 1f)

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], application = Application::class, qualifiers = "en-w360dp-h800dp-night-xhdpi")
class ScreenshotEnDarkTest : ScreenshotTest("en_dark", dark = true, fontScale = 1f)

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], application = Application::class, qualifiers = "in-w360dp-h800dp-xhdpi")
class ScreenshotIdFont150Test : ScreenshotTest("id_font150", dark = false, fontScale = 1.5f)
