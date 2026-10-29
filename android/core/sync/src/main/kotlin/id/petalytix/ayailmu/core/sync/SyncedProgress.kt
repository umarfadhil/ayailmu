package id.petalytix.ayailmu.core.sync

import id.petalytix.ayailmu.core.content.ContentJson
import id.petalytix.ayailmu.core.content.GatedContent
import id.petalytix.ayailmu.core.engine.RuleConfig
import id.petalytix.ayailmu.core.engine.SkillProjector
import id.petalytix.ayailmu.core.model.AnswerEvent

/** Separate read-only lane. Never writes remote records into local Room/mastery history. */
object SyncedProgress {
    fun events(binding: Binding): List<AnswerEvent> = if (!binding.enabled) emptyList() else binding.remote.filter { it.registryStatus == "registered" }.mapNotNull { record ->
        val e = ContentJson.json.decodeFromString(AnswerEvent.serializer(), record.payload)
        e.takeIf { it.synthetic && it.learnerId == binding.learner.clientLearnerId && it.track == binding.proof.track && it.contentVersion == binding.proof.contentVersion && it.rulesVersion == binding.proof.rulesVersion }
    }
    fun project(binding: Binding, localProof: PackProof, rules: RuleConfig, content: GatedContent): SkillProjector.Projection {
        require(binding.proof == localProof && rules.rulesVersion == localProof.rulesVersion && content.contentVersion == localProof.contentVersion)
        return SkillProjector.project(events(binding), rules, content)
    }
}
