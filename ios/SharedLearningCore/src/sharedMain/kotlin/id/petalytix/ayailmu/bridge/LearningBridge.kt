package id.petalytix.ayailmu.bridge

import id.petalytix.ayailmu.core.content.*
import id.petalytix.ayailmu.core.engine.*
import id.petalytix.ayailmu.core.model.*
import id.petalytix.ayailmu.bridge.platform.Instant
import id.petalytix.ayailmu.bridge.platform.ZoneId
import id.petalytix.ayailmu.bridge.platform.randomUUID
import kotlinx.serialization.json.*

/** String-only ABI; all learning decisions call the actual shared Android source functions. */
class LearningBridge {
    private val json = ContentJson.json
    val versionID: String get() = "ayailmu-session-v1-" + SharedSourceFingerprint.value
    private fun context(raw: String): JsonObject = json.parseToJsonElement(raw).jsonObject
    private fun JsonObject.text(key: String): String = getValue(key).jsonPrimitive.content
    private fun history(raw: String): List<AnswerEvent> = json.parseToJsonElement(raw).jsonArray.map { json.decodeFromString(AnswerEvent.serializer(),it.jsonPrimitive.content) }
    private fun rules(raw: String): RuleConfig = json.decodeFromString(RuleConfig.serializer(),raw)
    private fun content(packJSON: String, unit: String? = null): GatedContent {
        val pack = PackLoader.parse(packJSON)
        require(!pack.synthetic)
        val gated = Gating.gate(pack,false)
        return if (unit == null) gated else gated.copy(items = gated.items.filter { it.unit == unit && (it.audience == null || it.audience == Audience.ADULTS) }, screens = gated.screens.filter { it.unit == unit && (it.audience == null || it.audience == Audience.ADULTS) })
    }
    private fun snapshot(state: SessionState): String = buildJsonObject {
        put("stateJSON",Session.encode(state)); put("step",state.index); put("completed",state.phase == SessionState.Phase.DONE)
        val step = state.currentStep
        put("phase",when { state.phase == SessionState.Phase.DONE -> "done"; state.phase == SessionState.Phase.FEEDBACK -> "feedback"; step?.kind == Step.Kind.SCREEN -> "screen"; else -> "step" })
        put("currentItemID",if (step?.kind == Step.Kind.ITEM) JsonPrimitive(step.id) else JsonNull)
        put("screenID",if (step?.kind == Step.Kind.SCREEN) JsonPrimitive(step.id) else JsonNull)
        put("feedbackIDs",JsonArray(emptyList())); put("feedbackMessages",JsonArray(state.feedback?.messages.orEmpty().map(::JsonPrimitive)))
    }.toString()
    @Throws(Exception::class)
    fun start(packJSON: String,rulesJSON: String,contextJSON: String,historyJSON: String): String {
        val c = context(contextJSON); val r = rules(rulesJSON); val gated = content(packJSON,c.text("unit")); require(!gated.empty && gated.items.isNotEmpty())
        val ids = IdGenerator { prefix -> if (prefix == "ses") c["session_id"]?.jsonPrimitive?.content ?: "ses-${randomUUID()}" else "$prefix-${randomUUID()}" }
        return snapshot(Session.start(StartArgs(gated,r,history(historyJSON).filter { it.track == gated.track && it.learnerId == c.text("learner_id") },c.text("learner_id"),Lang.fromTag(c.text("lang")),Audience.ADULTS,Instant.parse(c.text("timestamp")).toEpochMilli(),ZoneId.of(c.text("zone_id")),r.defaultSessionMinutes,c["screens_seen"]?.jsonPrimitive?.content?.let { json.parseToJsonElement(it).jsonArray.map { v -> v.jsonPrimitive.content } } ?: emptyList(),c.text("app_version"),SeededRngFactory.forSession(c.text("learner_id"),history(historyJSON).filter { it.track == gated.track && it.learnerId == c.text("learner_id") }.map { it.sessionId }.distinct().size),ids)))
    }
    @Throws(Exception::class)
    fun submit(packJSON: String,rulesJSON: String,stateJSON: String,responseJSON: String,contextJSON: String,historyJSON: String): String {
        val gated = content(packJSON); val s = requireNotNull(Session.restore(stateJSON,gated)); val c = context(contextJSON)
        require(s.learnerId == c.text("learner_id") && s.sessionId == c.text("session_id"))
        val result = Session.submit(s,json.decodeFromString(Response.serializer(),responseJSON),Env(gated,rules(rulesJSON),history(historyJSON).filter { it.track == gated.track && it.learnerId == c.text("learner_id") },Instant.parse(c.text("timestamp")).toEpochMilli(),c["time_on_item_ms"]?.jsonPrimitive?.longOrNull ?: 0,ids=IdGenerator { c.text("answer_id") }))
        val event = requireNotNull(result.event)
        return buildJsonObject { put("eventPayload",json.encodeToString(AnswerEvent.serializer(),event)); put("next",json.parseToJsonElement(snapshot(result.state))) }.toString()
    }
    @Throws(Exception::class)
    fun advance(packJSON: String,rulesJSON: String,stateJSON: String,contextJSON: String): String {
        val s = requireNotNull(Session.restore(stateJSON,content(packJSON)))
        val c = context(contextJSON); require(s.learnerId == c.text("learner_id") && s.sessionId == c.text("session_id"))
        return snapshot(Session.advance(s,Instant.parse(c.text("timestamp")).toEpochMilli()))
    }
    @Throws(Exception::class)
    fun project(packJSON: String,rulesJSON: String,historyJSON: String,contextJSON: String): String {
        val gated = content(packJSON); val c = context(contextJSON)
        val result = SkillProjector.project(history(historyJSON).filter { it.track == gated.track && it.learnerId == c.text("learner_id") },rules(rulesJSON),gated)
        return buildJsonObject {
            put("skills",buildJsonObject { result.skills.forEach { (id,state) -> put(id,buildJsonObject { put("status",state.status.name); put("fresh_attempts",state.freshAttempts); put("rules_version",state.rulesVersion) }) } })
            put("words",buildJsonObject { result.words.forEach { (id,state) -> put(id,buildJsonObject { put("learned",state.learned); put("correct_days",state.correctDays) }) } })
        }.toString()
    }
    /** Generic platform seam evaluation used by cross-target contract tests. No test vectors ship here. */
    @Throws(Exception::class)
    fun platformEvaluate(requestJSON: String): String {
        val c = context(requestJSON)
        return when (c.text("operation")) {
            "epoch" -> JsonPrimitive(Instant.parse(c.text("value")).toEpochMilli())
            "days" -> JsonPrimitive(Dates.daysBetween(c.text("from"),c.text("to")))
            "add" -> JsonPrimitive(Dates.addDays(c.text("date"),c.text("days").toLong()))
            "local_date" -> JsonPrimitive(Dates.localDate(Instant.parse(c.text("value")).toEpochMilli(),ZoneId.of(c.text("zone"))))
            "normalize" -> JsonPrimitive(Text.normalize(c.text("value")))
            else -> error("Unsupported platform operation")
        }.toString()
    }
}
