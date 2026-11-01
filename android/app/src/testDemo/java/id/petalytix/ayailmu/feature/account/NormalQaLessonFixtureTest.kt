package id.petalytix.ayailmu.feature.account

import id.petalytix.ayailmu.core.content.ContentJson
import id.petalytix.ayailmu.core.content.ContentPack
import id.petalytix.ayailmu.core.content.Gating
import id.petalytix.ayailmu.core.content.PackLoader
import id.petalytix.ayailmu.core.content.PackValidator
import id.petalytix.ayailmu.core.data.Profile
import id.petalytix.ayailmu.core.data.ProfileKind
import id.petalytix.ayailmu.core.data.repo.LoadedTrack
import id.petalytix.ayailmu.core.engine.RuleConfig
import id.petalytix.ayailmu.core.engine.Scoring
import id.petalytix.ayailmu.core.model.Audience
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.core.model.Outcome
import id.petalytix.ayailmu.core.model.Response
import id.petalytix.ayailmu.core.model.Subject
import id.petalytix.ayailmu.core.sync.PackProof
import id.petalytix.ayailmu.feature.modules.ModuleModel
import java.io.File
import org.junit.Assert.*
import org.junit.Test

class NormalQaLessonFixtureTest {
    private fun repoFile(relative: String): File = listOf(File(relative), File("android/$relative"), File("../$relative")).first { it.exists() }
    private fun asset(relative: String) = repoFile("app/src/normalQa/assets/$relative")
    @Test fun realArithmeticAssetPassesContentRulesModuleAndAnswerScoring() {
        val packBytes = asset("packs/normal_qa/arithmetic/v1.json").readBytes()
        val rulesBytes = asset("config/rules.normal-qa-arithmetic.json").readBytes()
        val pack = PackLoader.parse(packBytes.decodeToString())
        val samePack = ContentJson.json.decodeFromString(ContentPack.serializer(), packBytes.decodeToString())
        assertEquals(pack, samePack)
        assertEquals(emptyList<String>(), PackValidator.validate(pack).map { it.path })
        assertEquals(2, pack.items.size)
        assertEquals("adults", pack.meta.audiences.single().name.lowercase())
        pack.items.forEach { assertEquals("approved", it.reviewStatus.name.lowercase()) }
        assertEquals("b", pack.items[0].options.single { it.correct }.id)
        assertEquals("b", pack.items[1].options.single { it.correct }.id)
        val rules = RuleConfig.parse(rulesBytes.decodeToString())
        assertEquals("normal-qa-arithmetic", rules.track)
        val content = Gating.gate(pack, developerDemo = false)
        assertEquals(2, content.items.size)
        val profile = Profile("qa", "QA", ProfileKind.ADULT, null, null, Audience.ADULTS, Lang.ID, 0, null, 1f, emptyList(), null)
        val loaded = LoadedTrack("normal-qa-arithmetic", pack, rules, content, emptyList(), listOf("01"))
        val facts = ModuleModel.facts(loaded, emptyList(), emptySet(), profile) { true }
        val module = ModuleModel.module(Subject.MATEMATIKA, listOf(facts), Audience.ADULTS, null)
        assertEquals("normal-qa-arithmetic", module?.track)
        assertEquals(Outcome.CORRECT, Scoring.scoreItem(pack.items[0], Response.choice("b"), rules, Lang.ID).outcome)
        assertEquals(Outcome.WRONG, Scoring.scoreItem(pack.items[0], Response.choice("a"), rules, Lang.ID).outcome)
        assertEquals(Outcome.CORRECT, Scoring.scoreItem(pack.items[1], Response.choice("b"), rules, Lang.ID).outcome)
        val proof = PackProof.fromBytes(packBytes, rulesBytes, "0".repeat(40))
        assertEquals("normal-qa-arithmetic-0.1", proof.contentVersion)
        assertEquals("normal-qa-casual-0.1", proof.rulesVersion)
    }
    @Test fun fixtureIsNotInProductionCatalog() {
        val catalog = repoFile("content/src/main/assets/config/catalog.json")
        assertFalse(catalog.readText().contains("normal-qa-arithmetic"))
        assertFalse(repoFile("app/src/main/res/xml").resolve("normal_qa_network_security.xml").exists())
    }
}
