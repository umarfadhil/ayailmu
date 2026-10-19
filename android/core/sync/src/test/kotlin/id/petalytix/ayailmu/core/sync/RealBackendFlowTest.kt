package id.petalytix.ayailmu.core.sync

import id.petalytix.ayailmu.core.content.ContentJson
import id.petalytix.ayailmu.core.content.Gating
import id.petalytix.ayailmu.core.content.PackLoader
import id.petalytix.ayailmu.core.engine.*
import id.petalytix.ayailmu.core.model.*
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.time.Instant
import java.time.ZoneId
import kotlin.random.Random
import kotlin.test.*
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import org.junit.Assume.assumeTrue
import org.junit.Test

/** Actual native Session/SkillProjector + actual Kotlin journal/HTTP + actual Go/Postgres/Keycloak. */
class RealBackendFlowTest {
    private class Faults(private val actual: Backend, private val expired: String) : Backend by actual {
        var offline = false
        var lostReceipt = false
        var expire = false
        override suspend fun append(token: String, learnerId: String, payloads: List<String>): List<Receipt> {
            if (offline) throw IOException("Synthetic network disconnected")
            val result=actual.append(if(expire) expired else token,learnerId,payloads)
            if(lostReceipt){lostReceipt=false;throw IOException("Synthetic connection lost after server commit")}
            return result
        }
        override suspend fun catalog(token: String): Catalog {
            if(offline)throw IOException("Synthetic network disconnected")
            return actual.catalog(token)
        }
    }
    @Test fun nativeOfflineRetrySecondClientRevokeExpiryAndAccountIsolation() = runTest {
        val fixture=System.getenv("UMAR_E2E_FIXTURES")
        assumeTrue("Run integration/run-e2e.sh for real local services",!fixture.isNullOrBlank())
        val tokens=Json.parseToJsonElement(File(fixture!!).readText()).jsonObject
        val tokenA=tokens.getValue("A").jsonPrimitive.content;val tokenB=tokens.getValue("B").jsonPrimitive.content
        val actual=HttpBackend(tokens["api"]?.jsonPrimitive?.content ?: "http://127.0.0.1:8186");val faults=Faults(actual,tokens.getValue("expired").jsonPrimitive.content)
        val packBytes=resource("packs/bahasa/arab/v1.json");val rulesBytes=resource("config/rules.arab.json")
        val proof=PackProof.fromBytes(packBytes,rulesBytes,"815e30f0da284b9818fadc0143f4da92544384d3")
        val pack=PackLoader.parse(packBytes.decodeToString());val content=Gating.gate(pack,true);val rules=RuleConfig.parse(rulesBytes.decodeToString())
        val dir=Files.createTempDirectory("umar-real-native-e2e").toFile()
        try {
            val journal=File(dir,"client-a.json");val first=SyncEngine(faults,FileJournal(journal))
            val ownerA=first.login(tokenA);val learner=first.createSyntheticLearner();first.select(learner,proof)
            val generated=nativeAnswers(learner.clientLearnerId,content,rules)
            first.capture(listOf(generated[0]));assertEquals(0,first.pendingCount());assertEquals(SyncResult.CONSENT_OFF,first.sync())
            first.enable(listOf(id(generated[0])))
            faults.offline=true;first.capture(listOf(generated[0],generated[1]));assertEquals(1,first.pendingCount());assertEquals(SyncResult.OFFLINE,first.sync())
            // Process restart with no persisted access token. Same owner explicitly signs in again.
            val restored=SyncEngine(faults,FileJournal(journal));assertFalse(restored.authenticated());assertEquals(1,restored.pendingCount())
            faults.offline=false;assertEquals(ownerA,restored.login(tokenA));restored.select(learner,proof)
            faults.lostReceipt=true;assertEquals(SyncResult.OFFLINE,restored.sync());assertEquals(1,restored.pendingCount())
            assertEquals(SyncResult.SYNCED,restored.sync());assertEquals(0,restored.pendingCount());assertEquals(generated[1],restored.history().single().payload)
            val wirePage=actual.pull(tokenA,learner.id,0);assertEquals(1,wirePage.events.size);assertEquals(generated[1],wirePage.events.single().payload)
            // A second real client, with a distinct persistent journal, gets the same native progress.
            val second=SyncEngine(actual,FileJournal(File(dir,"client-b.json")));second.login(tokenA);second.select(learner,proof);second.enable(emptyList())
            assertEquals(SyncResult.SYNCED,second.sync());assertEquals(restored.history(),second.history())
            val expected=SkillProjector.project(listOf(decode(generated[1])),rules,content)
            val secondBinding=assertNotNull(second.binding());assertEquals(expected,SyncedProgress.project(secondBinding,proof,rules,content))
            // Remote revocation freezes pending data, and cannot be silently re-enabled by a retry.
            restored.capture(listOf(generated[2]));assertEquals(1,restored.pendingCount());assertEquals(SyncResult.SYNCED,second.disable())
            assertEquals(SyncResult.CONSENT_OFF,restored.sync());assertTrue(restored.history().isEmpty());assertEquals(1,restored.pendingCount())
            restored.enable(generated.map(::id));faults.expire=true
            assertEquals(SyncResult.LOGIN_REQUIRED,restored.sync());assertEquals(1,restored.pendingCount());assertFalse(restored.authenticated())
            faults.expire=false;restored.login(tokenA);restored.select(learner,proof);assertEquals(SyncResult.SYNCED,restored.sync());assertEquals(2,restored.history().size)
            // Explicit off excludes future local answers and keeps the original local native history intact.
            restored.disable();restored.capture(listOf(generated[3]));assertEquals(0,restored.pendingCount());assertEquals(SyncResult.CONSENT_OFF,restored.sync())
            restored.logout();assertNull(restored.owner());assertNull(restored.binding());assertTrue(restored.history().isEmpty())
            val ownerB=restored.login(tokenB);assertNotEquals(ownerA,ownerB);assertTrue(restored.knownLearners().isEmpty())
            val denied=assertFailsWith<ApiFailure>{actual.pull(tokenB,learner.id,0)};assertEquals(404,denied.status)
            assertFailsWith<IllegalArgumentException>{restored.select(learner,proof)}
            val other=restored.createSyntheticLearner();restored.select(other,proof);restored.enable(emptyList())
            restored.capture(nativeAnswers(other.clientLearnerId,content,rules).take(1));assertEquals(SyncResult.SYNCED,restored.sync());assertEquals(1,restored.history().size)
            restored.logout();restored.login(tokenA);restored.select(learner,proof);assertFalse(restored.binding()!!.enabled);assertTrue(restored.history().isEmpty())
            assertFalse(journal.readText().contains(tokenA));assertFalse(journal.readText().contains(tokenB))
            println("REAL_NATIVE_E2E_PASS: verified provider sessions; offline native Session; persisted exact-byte outbox; server-committed retry; second-client native SkillProjector; revocation; signed expired token; logout; owner/learner isolation")
        } finally {dir.deleteRecursively()}
    }
    private fun id(raw:String)=decode(raw).answerId
    private fun decode(raw:String)=ContentJson.json.decodeFromString(AnswerEvent.serializer(),raw)
    private fun resource(path:String)=requireNotNull(javaClass.classLoader.getResourceAsStream(path)).use{it.readBytes()}
    private fun nativeAnswers(learnerId:String,content:id.petalytix.ayailmu.core.content.GatedContent,rules:RuleConfig):List<String>{
        val now=Instant.parse("2026-10-19T01:00:00Z").toEpochMilli();val ids=UuidIdGenerator
        var state=Session.start(StartArgs(content,rules,emptyList(),learnerId,Lang.ID,Audience.ADULTS,now,ZoneId.of("UTC"),15,emptyList(),"0.1.0-synclab",Random(1),ids))
        val history=mutableListOf<AnswerEvent>()
        while(history.size<4){
            while(state.currentStep?.kind==Step.Kind.SCREEN)state=Session.advance(state,now)
            val item=content.item(state.currentStep!!.id)
            val response=if(item.type==ItemType.TYPE_IN) Response.typed("jujur") else Response.dontKnow()
            val result=Session.submit(state,response,Env(content,rules,history,now+history.size*1000,1000,false,ids))
            val event=assertNotNull(result.event);assertTrue(event.synthetic);history+=event;state=Session.advance(result.state,now)
        }
        return history.map{ContentJson.json.encodeToString(AnswerEvent.serializer(),it)}
    }
}
