package id.petalytix.ayailmu.bridge

import java.io.File
import kotlinx.serialization.json.*
import kotlin.test.*

class BridgeParityTest {
    @Test fun originalSharedSessionProducesDeterministicGolden() {
        val pack = javaClass.getResource("/bridge-pack.json")!!.readText()
        val rules = javaClass.getResource("/bridge-rules.json")!!.readText()
        val bridge = LearningBridge(); val json = Json
        val context = buildJsonObject {
            put("learner_id","native-a"); put("session_id","session-fixture"); put("unit","01"); put("lang","en"); put("app_version","0.2"); put("zone_id","UTC"); put("timestamp","2026-10-27T12:00:00Z"); put("time_on_item_ms","17")
        }
        val history = mutableListOf<String>(); val operations = mutableListOf<JsonElement>()
        fun historyJSON() = JsonArray(history.map(::JsonPrimitive)).toString()
        fun response(id: String): String = when(id) {
            "FIX-Q1" -> "{\"kind\":\"choice\",\"option_id\":\"a\"}"
            "FIX-TF" -> "{\"kind\":\"dont_know\"}"
            "FIX-G1" -> "{\"kind\":\"choice\",\"option_id\":\"seen\"}"
            "FIX-TILES" -> "{\"kind\":\"sequence\",\"sequence\":[\"a\",\"b\"]}"
            "FIX-BLANK" -> "{\"kind\":\"sequence\",\"sequence\":[\"a\"]}"
            "FIX-PAIRS" -> "{\"kind\":\"pairs\",\"pairs\":[{\"left\":\"l1\",\"right\":\"r1\"},{\"left\":\"l2\",\"right\":\"r2\"}]}"
            else -> "{\"kind\":\"number\",\"value\":"+(when(id) { "FIX-Q2" -> "7"; "FIX-SLIDER" -> "9"; else -> "3" })+"}"
        }
        var snapshot = json.parseToJsonElement(bridge.start(pack,rules,context.toString(),historyJSON())).jsonObject
        operations += buildJsonObject { put("op","start"); put("context",context); put("output",snapshot) }
        var answers = 0
        repeat(40) {
            val phase = snapshot.getValue("phase").jsonPrimitive.content
            if (phase == "done") return@repeat
            val state = snapshot.getValue("stateJSON").jsonPrimitive.content
            if (phase == "step") {
                val id = snapshot.getValue("currentItemID").jsonPrimitive.content
                assertNotEquals("FIX-DP",id,"Daily puzzle must not enter the event session")
                val raw = response(id); val c = JsonObject(context + ("answer_id" to JsonPrimitive("answer-${++answers}")))
                val output = json.parseToJsonElement(bridge.submit(pack,rules,state,raw,c.toString(),historyJSON())).jsonObject
                operations += buildJsonObject { put("op","submit"); put("context",c); put("state",state); put("response",raw); put("history",historyJSON()); put("output",output) }
                history += output.getValue("eventPayload").jsonPrimitive.content; snapshot = output.getValue("next").jsonObject
            } else {
                val output = json.parseToJsonElement(bridge.advance(pack,rules,state,context.toString())).jsonObject
                operations += buildJsonObject { put("op","advance"); put("context",context); put("state",state); put("output",output) }; snapshot = output
            }
        }
        assertEquals("done",snapshot.getValue("phase").jsonPrimitive.content); assertEquals(9,history.size)
        assertTrue(history.any { it.contains("FIX-R1") },"Wrong answer inserts the actual shared REMED transition")
        assertTrue(history.any { it.contains("dont_know") }); assertTrue(history.any { it.contains("not_assessed") })
        // A new content version must not reset first-attempt history; seen introductions remain seen.
        val newPack = pack.replace("fixture-v1","fixture-v2")
        val nextContext = JsonObject(context + mapOf("session_id" to JsonPrimitive("session-next"),"timestamp" to JsonPrimitive("2026-10-28T12:00:00Z"),"screens_seen" to JsonPrimitive("[\"FIX-S1\"]")))
        var next = json.parseToJsonElement(bridge.start(newPack,rules,nextContext.toString(),historyJSON())).jsonObject
        operations += buildJsonObject { put("op","start"); put("pack",newPack); put("context",nextContext); put("history",historyJSON()); put("output",next) }
        assertEquals("step",next.getValue("phase").jsonPrimitive.content)
        val raw = response(next.getValue("currentItemID").jsonPrimitive.content)
        val c = JsonObject(nextContext + ("answer_id" to JsonPrimitive("answer-${++answers}")))
        val output = json.parseToJsonElement(bridge.submit(newPack,rules,next.getValue("stateJSON").jsonPrimitive.content,raw,c.toString(),historyJSON())).jsonObject
        operations += buildJsonObject { put("op","submit"); put("pack",newPack); put("context",c); put("state",next.getValue("stateJSON")); put("response",raw); put("history",historyJSON()); put("output",output) }
        val repeated = output.getValue("eventPayload").jsonPrimitive.content
        assertFalse(json.parseToJsonElement(repeated).jsonObject.getValue("first_attempt").jsonPrimitive.boolean)
        history += repeated
        val projection = json.parseToJsonElement(bridge.project(pack,rules,historyJSON(),context.toString()))
        val vectors = json.parseToJsonElement(javaClass.getResource("/bridge-platform.json")!!.readText()).jsonArray
        val platform = vectors.map { request -> buildJsonObject { put("request",request); put("output",json.parseToJsonElement(bridge.platformEvaluate(request.toString()))) } }
        val golden = buildJsonObject { put("fixture_only",true); put("operations",JsonArray(operations)); put("history",historyJSON()); put("projection",projection); put("platform",JsonArray(platform)) }
        val file = File("build/parity/jvm-golden.json"); file.parentFile.mkdirs(); file.writeText(golden.toString()+"\n")
    }
}
