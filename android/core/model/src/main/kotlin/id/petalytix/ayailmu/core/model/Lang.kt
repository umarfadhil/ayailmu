package id.petalytix.ayailmu.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Instruction languages the app supports (CR-I18N-2). The Android locale tag for Indonesian is "id"
 * (the platform may report the legacy "in"); [tag] is what we store, never the platform's value.
 */
@Serializable
enum class Lang(val tag: String) {
    @SerialName("id")
    ID("id"),

    @SerialName("en")
    EN("en"),
    ;

    companion object {
        fun fromTag(tag: String): Lang =
            when (tag.lowercase().substringBefore('-')) {
                "id", "in" -> ID
                "en" -> EN
                else -> ID
            }
    }
}
