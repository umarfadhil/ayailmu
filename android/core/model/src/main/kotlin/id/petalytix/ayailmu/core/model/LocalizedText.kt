package id.petalytix.ayailmu.core.model

import kotlinx.serialization.Serializable

/**
 * Every learner-facing string inside a content pack carries both languages (CR-I18N-1).
 * There is deliberately no fallback in [resolve]: a missing language is a validator error at build time,
 * not something the runtime papers over (CR-I18N-2).
 */
@Serializable
data class LocalizedText(
    val id: String,
    val en: String,
) {
    fun resolve(lang: Lang): String =
        when (lang) {
            Lang.ID -> id
            Lang.EN -> en
        }

    val isComplete: Boolean get() = id.isNotBlank() && en.isNotBlank()
}
