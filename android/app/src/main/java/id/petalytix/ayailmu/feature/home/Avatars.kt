package id.petalytix.ayailmu.feature.home

import id.petalytix.ayailmu.core.data.Profile

/**
 * Profile pictures (follow-up 12, MODULES_LEVELS_STORIES.md section 8: never a letter where a picture belongs). A
 * profile shows one animal from the shared `pic_*` vocabulary art; until it picks one, a stable default chosen by
 * its id. The choice lives in `ProfileChoiceStore` (device settings), not in Room, and is not personal data.
 */
object Avatars {
    val KEYS: List<String> =
        listOf(
            "pic_cat", "pic_dog", "pic_rabbit", "pic_bird", "pic_fish", "pic_duck",
            "pic_chicken", "pic_cow", "pic_goat", "pic_horse", "pic_elephant", "pic_monkey",
        )

    /** String.hashCode is specified by the JDK, so the default never changes between runs or devices. */
    fun defaultFor(profileId: String): String = KEYS[Math.floorMod(profileId.hashCode(), KEYS.size)]

    /** The picked animal when it is still one of [KEYS]; otherwise the default. */
    fun of(
        profileId: String,
        chosen: String?,
    ): String = chosen?.takeIf { it in KEYS } ?: defaultFor(profileId)

    fun resolve(
        profiles: List<Profile>,
        chosen: Map<String, String>,
    ): Map<String, String> = profiles.associate { it.id to of(it.id, chosen[it.id]) }
}
