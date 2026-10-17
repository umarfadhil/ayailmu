package id.petalytix.ayailmu.core.design.components

import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics

/** Marks a screen or section title as a heading, so TalkBack users can jump between sections (CR-A11Y-1). */
fun Modifier.headingSemantics(): Modifier = this.semantics { heading() }
