package id.petalytix.ayailmu.feature.store

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.MotionDurationScale
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.onLongClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.petalytix.ayailmu.BuildConfig
import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.billing.BillingNotice
import id.petalytix.ayailmu.core.billing.Product
import id.petalytix.ayailmu.core.design.art.ArtImage
import id.petalytix.ayailmu.core.design.components.AyaButton
import id.petalytix.ayailmu.core.design.components.AyaSecondaryButton
import id.petalytix.ayailmu.core.design.components.AyaTextField
import id.petalytix.ayailmu.core.design.components.PaperBackground
import id.petalytix.ayailmu.core.design.components.PaperCard
import id.petalytix.ayailmu.core.design.components.headingSemantics
import id.petalytix.ayailmu.core.design.theme.AyaRadius
import id.petalytix.ayailmu.core.design.theme.AyaSpacing
import id.petalytix.ayailmu.core.design.theme.AyaTheme
import id.petalytix.ayailmu.core.design.theme.AyaThemeTokens
import id.petalytix.ayailmu.feature.modules.ArtWithFallback
import id.petalytix.ayailmu.feature.session.PictureMessage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Composable
fun StoreRoute(
    onBack: () -> Unit,
    viewModel: StoreViewModel = hiltViewModel(),
) {
    if (!BuildConfig.BILLING_ENABLED) {
        Column(Modifier.fillMaxSize().safeDrawingPadding().padding(AyaSpacing.lg), verticalArrangement = Arrangement.spacedBy(AyaSpacing.md)) {
            Text(stringResource(R.string.normal_account_store_unavailable), style = MaterialTheme.typography.bodyLarge)
            AyaSecondaryButton(text = stringResource(R.string.action_back), onClick = onBack, modifier = Modifier.fillMaxWidth())
        }
        return
    }
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    StoreScreen(
        state = state,
        onEvent = viewModel::onEvent,
        onBuy = { product -> context.findActivity()?.let { viewModel.buy(it, product) } },
        onBack = onBack,
    )
}

private tailrec fun Context.findActivity(): Activity? =
    when (this) {
        is Activity -> this
        is ContextWrapper -> baseContext.findActivity()
        else -> null
    }

/**
 * The store (P5, MONETIZATION_SCHEME): six one-time products (Sejarah since follow-up 12; Nilai is free and has none),
 * Play's prices only, no countdowns, no "only today", no badges pushing all-access. A child profile meets the adult
 * gate first (CR-BIL-5).
 */
@Composable
fun StoreScreen(
    state: StoreUiState,
    onEvent: (StoreEvent) -> Unit,
    onBuy: (Product) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = AyaThemeTokens.colors
    LaunchedEffect(state.notice) {
        if (state.notice != null) {
            delay(NOTICE_MS)
            onEvent(StoreEvent.NoticeShown)
        }
    }
    Column(
        modifier = modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(AyaSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(AyaSpacing.md),
    ) {
        TextButton(onClick = onBack) { Text(stringResource(R.string.action_back), color = colors.accentDeep) }
        Text(stringResource(R.string.store_title), style = MaterialTheme.typography.displaySmall, color = colors.ink, modifier = Modifier.headingSemantics())
        Text(stringResource(R.string.store_intro), style = MaterialTheme.typography.bodyLarge, color = colors.inkSoft)
        state.notice?.let { NoticeLine(it) }
        val data = state.data
        if (data?.demo == true) {
            PaperCard(edge = colors.slate) {
                Text(
                    stringResource(if (data.unlockAll) R.string.store_demo_unlocked else R.string.store_demo_free_tier),
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.ink,
                )
            }
        }
        when {
            state.failed -> PictureMessage("state_error", stringResource(R.string.store_failed), null)
            data == null -> Unit
            state.gate != null -> AdultGateCard(state.gate, onEvent)
            else -> {
                data.items.forEach { item -> ProductCard(item, busy = state.busy, onBuy = { onBuy(item.product) }) }
                if (!data.pricesAvailable) {
                    Text(stringResource(R.string.store_prices_unavailable), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
                }
                AyaSecondaryButton(
                    text = stringResource(R.string.store_restore),
                    enabled = !state.busy,
                    onClick = { onEvent(StoreEvent.Restore) },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        Text(stringResource(R.string.store_footer), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
    }
}

@Composable
private fun NoticeLine(notice: BillingNotice) {
    val colors = AyaThemeTokens.colors
    val text =
        when (notice) {
            is BillingNotice.Purchased -> stringResource(R.string.store_notice_purchased, stringResource(productTitle(notice.product)))
            is BillingNotice.Pending -> stringResource(R.string.store_notice_pending, stringResource(productTitle(notice.product)))
            BillingNotice.Cancelled -> stringResource(R.string.store_notice_cancelled)
            BillingNotice.AlreadyOwned -> stringResource(R.string.store_notice_owned)
            BillingNotice.Unavailable -> stringResource(R.string.store_notice_unavailable)
            BillingNotice.Failed -> stringResource(R.string.store_notice_failed)
            BillingNotice.Restored -> stringResource(R.string.store_notice_restored)
            BillingNotice.NothingToRestore -> stringResource(R.string.store_notice_nothing)
        }
    val good = notice is BillingNotice.Purchased || notice == BillingNotice.Restored
    PaperCard(edge = if (good) colors.correct else colors.slate) {
        Text(text, style = MaterialTheme.typography.bodyLarge, color = colors.ink)
    }
}

internal fun productTitle(p: Product): Int =
    when (p) {
        Product.ALL_ACCESS -> R.string.store_product_all
        Product.PACK_BAHASA -> R.string.store_product_bahasa
        Product.PACK_MATEMATIKA -> R.string.store_product_matematika
        Product.PACK_SAINS -> R.string.store_product_sains
        Product.PACK_SOSIAL_SENI -> R.string.store_product_sosial_seni
        Product.PACK_SEJARAH -> R.string.store_product_sejarah
    }

private fun productBody(p: Product): Int =
    when (p) {
        Product.ALL_ACCESS -> R.string.store_all_access_body
        Product.PACK_BAHASA -> R.string.store_product_bahasa_body
        Product.PACK_MATEMATIKA -> R.string.store_product_matematika_body
        Product.PACK_SAINS -> R.string.store_product_sains_body
        Product.PACK_SOSIAL_SENI -> R.string.store_product_sosial_seni_body
        Product.PACK_SEJARAH -> R.string.store_product_sejarah_body
    }

@Composable
private fun ProductCard(
    item: StoreItem,
    busy: Boolean,
    onBuy: () -> Unit,
) {
    val colors = AyaThemeTokens.colors
    val title = stringResource(productTitle(item.product))
    PaperCard(edge = if (item.owned) colors.correct else null) {
        Row(horizontalArrangement = Arrangement.spacedBy(AyaSpacing.md), verticalAlignment = Alignment.CenterVertically) {
            // Each pack shows its module's cover; all-access the gem box (never a text-only card, section 8).
            ArtWithFallback(
                key = item.product.subject?.coverKey() ?: "gem_box",
                contentDescription = null,
                modifier = Modifier.width(COVER_WIDTH),
            )
            Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(AyaSpacing.xs)) {
                Text(title, style = MaterialTheme.typography.titleLarge, color = colors.ink, modifier = Modifier.headingSemantics())
                Text(stringResource(productBody(item.product)), style = MaterialTheme.typography.bodyMedium, color = colors.inkSoft)
            }
        }
        when {
            item.owned -> Text(stringResource(R.string.store_owned), style = MaterialTheme.typography.labelLarge, color = colors.correct)
            item.pending -> Text(stringResource(R.string.store_pending), style = MaterialTheme.typography.labelLarge, color = colors.slate)
            else ->
                AyaButton(
                    text = item.price?.let { stringResource(R.string.store_buy_price, it) } ?: stringResource(R.string.store_buy),
                    enabled = !busy && item.price != null,
                    onClick = onBuy,
                    modifier = Modifier.fillMaxWidth(),
                )
        }
    }
}

@Composable
private fun AdultGateCard(
    gate: AdultGate,
    onEvent: (StoreEvent) -> Unit,
) {
    val colors = AyaThemeTokens.colors
    PaperCard(edge = colors.ochre) {
        // A grown-up's picture says "ask an adult" before a child reads a word.
        Row(horizontalArrangement = Arrangement.spacedBy(AyaSpacing.sm), verticalAlignment = Alignment.CenterVertically) {
            ArtImage("pic_woman", contentDescription = null, modifier = Modifier.width(GATE_ART))
            ArtImage("pic_man", contentDescription = null, modifier = Modifier.width(GATE_ART))
        }
        Text(stringResource(R.string.store_gate_title), style = MaterialTheme.typography.titleLarge, color = colors.ink, modifier = Modifier.headingSemantics())
        Text(stringResource(R.string.store_gate_body), style = MaterialTheme.typography.bodyLarge, color = colors.ink)
        Text(stringResource(R.string.store_gate_question, gate.a, gate.b), style = MaterialTheme.typography.titleLarge, color = colors.ink)
        AyaTextField(
            value = gate.answer,
            onValueChange = { onEvent(StoreEvent.GateAnswer(it)) },
            label = stringResource(R.string.store_gate_answer),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
        )
        HoldToConfirmButton(
            text = stringResource(R.string.store_gate_hold),
            enabled = gate.solved,
            onConfirmed = { onEvent(StoreEvent.GateConfirmed) },
        )
    }
}

/**
 * Press and hold for [HOLD_MS] to confirm; letting go early resets. The fill is direct feedback on the hold
 * and runs in real time even with animations off ([RealTime]). Screen readers get a long-press action with the
 * same label on the merged button node.
 */
@Composable
internal fun HoldToConfirmButton(
    text: String,
    enabled: Boolean,
    onConfirmed: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = AyaThemeTokens.colors
    val progress = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    val confirm by rememberUpdatedState(onConfirmed)
    Box(
        modifier =
            modifier
                .fillMaxWidth()
                .heightIn(min = AyaSpacing.touch)
                .clip(AyaRadius.md)
                .background(colors.paper)
                .drawBehind { drawRect(colors.accent.copy(alpha = 0.35f), size = size.copy(width = size.width * progress.value)) }
                .border(1.4.dp, if (enabled) colors.accent else colors.inkSoft.copy(alpha = 0.35f), AyaRadius.md)
                .pointerInput(enabled) {
                    if (!enabled) return@pointerInput
                    detectTapGestures(
                        onPress = {
                            // Real time, whatever the animator duration scale: with "Remove animations" the
                            // scale is 0 and a scaled hold would confirm on the first frame (CR-BIL-5).
                            val job =
                                scope.launch(RealTime) {
                                    progress.animateTo(1f, tween(HOLD_MS, easing = LinearEasing))
                                    confirm()
                                }
                            tryAwaitRelease()
                            if (progress.value < 1f) {
                                job.cancel()
                                scope.launch { progress.snapTo(0f) }
                            }
                        },
                    )
                }.semantics(mergeDescendants = true) {
                    role = Role.Button
                    onLongClick(label = text) {
                        if (enabled) confirm()
                        enabled
                    }
                }.padding(horizontal = AyaSpacing.lg, vertical = AyaSpacing.sm),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = MaterialTheme.typography.labelLarge, color = if (enabled) colors.ink else colors.inkSoft)
    }
}

/** Animations at normal speed regardless of the system animator scale (the hold is a timer, not decoration). */
private object RealTime : MotionDurationScale {
    override val scaleFactor: Float get() = 1f
}

private const val HOLD_MS = 1_500
private const val NOTICE_MS = 5_000L
private val COVER_WIDTH = 96.dp
private val GATE_ART = 64.dp

private val previewStore =
    StoreUiState(
        data =
            StoreData(
                items =
                    listOf(
                        StoreItem(Product.ALL_ACCESS, "Rp 149.000", owned = false, pending = false),
                        StoreItem(Product.PACK_BAHASA, "Rp 79.000", owned = false, pending = true),
                        StoreItem(Product.PACK_MATEMATIKA, "Rp 59.000", owned = true, pending = false),
                        StoreItem(Product.PACK_SAINS, null, owned = false, pending = false),
                        StoreItem(Product.PACK_SOSIAL_SENI, "Rp 59.000", owned = false, pending = false),
                        StoreItem(Product.PACK_SEJARAH, "Rp 59.000", owned = false, pending = false),
                    ),
                pricesAvailable = true,
                childProfile = false,
                demo = false,
                unlockAll = false,
            ),
    )

@Preview(name = "id · light", showBackground = true, locale = "id")
@Preview(name = "en · dark", showBackground = true, locale = "en", uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun StorePreview() {
    AyaTheme { PaperBackground { StoreScreen(state = previewStore, onEvent = {}, onBuy = {}, onBack = {}) } }
}

@Preview(name = "gate · id", showBackground = true, locale = "id")
@Composable
private fun StoreGatePreview() {
    AyaTheme {
        PaperBackground {
            StoreScreen(state = previewStore.copy(gate = AdultGate(7, 8, "56")), onEvent = {}, onBuy = {}, onBack = {})
        }
    }
}
