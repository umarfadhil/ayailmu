package id.petalytix.ayailmu.core.content

import id.petalytix.ayailmu.core.model.Audience
import id.petalytix.ayailmu.core.model.Lang
import id.petalytix.ayailmu.core.model.LocalizedText
import id.petalytix.ayailmu.core.model.Subject
import id.petalytix.ayailmu.core.model.TrackMode
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Header of a content pack (`content/packs/<subject>/<track>/v<N>.json`). Items are added to the schema in P1;
 * P0 ships only the header so the validator and loader have a stable contract to grow from (CR-ENG-1).
 */
@Serializable
data class PackMeta(
    @SerialName("schema_version") val schemaVersion: Int,
    @SerialName("content_version") val contentVersion: String,
    val subject: Subject,
    val track: String,
    val mode: TrackMode,
    val audiences: List<Audience>,
    @SerialName("instruction_langs") val instructionLangs: List<Lang>,
    @SerialName("target_lang") val targetLang: String? = null,
    val title: LocalizedText,
)
