package id.petalytix.ayailmu.feature.account

import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performScrollTo
import androidx.test.core.app.ApplicationProvider
import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.sync.Learner
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class NormalAccountComposeTest {
    @get:Rule val compose = createComposeRule()
    private fun text(id: Int, vararg args: Any) = ApplicationProvider.getApplicationContext<android.content.Context>().getString(id, *args)
    private class Events : NormalAccountEvents {
        var registered = false
        var restores = 0
        override fun show(target: NormalAccountMode, email: String) = Unit
        override fun back() = Unit
        override fun signUp(email: String, password: String, adult: Boolean) { registered = email == "real.owner@gmail.com" && password.length >= 12 && adult }
        override fun confirm(email: String, code: String, adult: Boolean) = Unit
        override fun signIn(email: String, password: String, adult: Boolean) = Unit
        override fun resend(email: String) = Unit
        override fun recover(email: String) = Unit
        override fun reset(email: String, code: String, password: String) = Unit
        override fun restoreSession() { restores++ }
        override fun signInAgain() = Unit
        override fun signOut() = Unit
        override fun createLearner(label: String, lang: String) = Unit
        override fun selectLearner(learner: Learner) = Unit
        override fun enableSync() = Unit
        override fun disableSync() = Unit
        override fun syncNow() = Unit
    }
    @Test fun registrationAcceptsGenuineMailboxOnlyWithValidPasswordAndDeclaration() {
        val events = Events()
        compose.setContent { NormalAccountScreen(NormalAccountUiState(true, NormalAccountMode.SIGN_UP), events) {} }
        compose.onAllNodesWithText(text(R.string.normal_account_register))[1].assertIsNotEnabled()
        compose.onNodeWithText(text(R.string.normal_account_email)).performTextInput("real.owner@gmail.com")
        compose.onNodeWithText(text(R.string.normal_account_password)).performTextInput("synthetic-password-123")
        compose.onAllNodesWithText(text(R.string.normal_account_register))[1].performScrollTo().assertIsNotEnabled()
        compose.onNode(isToggleable()).performScrollTo().performClick()
        compose.onNode(isToggleable()).assertIsOn()
        compose.onAllNodesWithText(text(R.string.normal_account_register))[1].performScrollTo().assertIsEnabled().performClick()
        compose.runOnIdle { assertEquals(true, events.registered) }
        compose.onAllNodesWithText("Google", substring = true).assertCountEquals(0)
        compose.onNodeWithText(text(R.string.normal_account_local_boundary)).assertExists()
    }
    @Test fun readyOwnerStatusHasRealLearnerAndCloudControls() {
        val learner = Learner("remote-a", "lrn_owner_a", "ADULT", "adults", "id")
        val state = NormalAccountUiState(true, account = NormalAccountState("real.owner@gmail.com"), sync = NormalSyncState(owner = "owner-a", authenticated = true, learners = listOf(learner), learnerLabels = mapOf(learner.clientLearnerId to "Owner learner"), selected = learner, enabled = true, pending = 2, restoredAnswers = 3))
        compose.setContent { NormalAccountScreen(state, Events()) {} }
        compose.onAllNodesWithText("Owner learner", substring = true).assertCountEquals(2)
        compose.onAllNodesWithText("lrn_owner_a").assertCountEquals(0)
        compose.onNodeWithText(text(R.string.normal_account_sync_now)).assertIsEnabled()
        compose.onNodeWithText(text(R.string.normal_account_logout)).assertIsEnabled()
        compose.onNodeWithText(text(R.string.normal_account_no_backfill)).assertExists()
    }

    @Test fun expiredSessionHasReachableRestoreAction() {
        val events = Events()
        val state = NormalAccountUiState(true, account = NormalAccountState("real.owner@gmail.com"), sync = NormalSyncState("owner-a", false))
        compose.setContent { NormalAccountScreen(state, events) {} }
        compose.onNodeWithText(text(R.string.normal_account_restore_action)).performScrollTo().assertIsEnabled().performClick()
        compose.runOnIdle { assertEquals(1, events.restores) }
    }


    @Test fun freshAuthHasSignInAgainInsteadOfRestoreLoop() {
        val state = NormalAccountUiState(true, account = NormalAccountState("real.owner@gmail.com"), sync = NormalSyncState("owner-a", false, notice = NormalSyncNotice.FRESH_AUTH_REQUIRED))
        compose.setContent { NormalAccountScreen(state, Events()) {} }
        compose.onNodeWithText(text(R.string.normal_account_sign_in_again)).assertIsEnabled()
        compose.onAllNodesWithText(text(R.string.normal_account_restore_action)).assertCountEquals(0)
    }

    @Test fun noApprovedContentNoticeSaysAccountUnchangedWithoutLabLabels() {
        val state = NormalAccountUiState(true, account = NormalAccountState("real.owner@gmail.com"), sync = NormalSyncState("owner-a", true, notice = NormalSyncNotice.NO_APPROVED_CONTENT))
        compose.setContent { NormalAccountScreen(state, Events()) {} }
        compose.onNodeWithText(text(R.string.normal_account_no_approved_content)).assertExists()
        compose.onAllNodesWithText(text(R.string.normal_account_sync_ready)).assertCountEquals(0)
        compose.onAllNodesWithText(text(R.string.normal_account_synced)).assertCountEquals(0)
        compose.onAllNodesWithText("synthetic", substring = true, ignoreCase = true).assertCountEquals(0)
        compose.onAllNodesWithText("sync lab", substring = true, ignoreCase = true).assertCountEquals(0)    }

    @Test fun contentMismatchNoticeTellsOwnerToUpdateTheApp() {
        val state = NormalAccountUiState(true, account = NormalAccountState("real.owner@gmail.com"), sync = NormalSyncState("owner-a", true, notice = NormalSyncNotice.CONTENT_MISMATCH))
        compose.setContent { NormalAccountScreen(state, Events()) {} }
        compose.onNodeWithText(text(R.string.normal_account_content_mismatch)).assertExists()
        compose.onAllNodesWithText(text(R.string.normal_account_sync_ready)).assertCountEquals(0)
        compose.onAllNodesWithText("synthetic", substring = true, ignoreCase = true).assertCountEquals(0)
        compose.onAllNodesWithText("sync lab", substring = true, ignoreCase = true).assertCountEquals(0)    }

    private val labelWords = Regex("\\b(lab|dev|demo|fake|synthetic|sync lab)\\b", RegexOption.IGNORE_CASE)

    @Test fun pendingCreateNoticeExplainsRetryInOrdinaryWordingAndIsHiddenOtherwise() {
        val pending = NormalAccountUiState(true, account = NormalAccountState("real.owner@gmail.com"), sync = NormalSyncState("owner-a", true, pendingCreate = true))
        compose.setContent { NormalAccountScreen(pending, Events()) {} }
        compose.onNodeWithText(text(R.string.normal_account_create_pending)).assertExists()
        compose.onNodeWithText(text(R.string.normal_account_create_learner)).assertExists()
        assertEquals(null, labelWords.find(text(R.string.normal_account_create_pending)))
    }

    @Test fun noPendingNoticeWhenNothingIsUnresolved() {
        val none = NormalAccountUiState(true, account = NormalAccountState("real.owner@gmail.com"), sync = NormalSyncState("owner-a", true))
        compose.setContent { NormalAccountScreen(none, Events()) {} }
        compose.onAllNodesWithText(text(R.string.normal_account_create_pending)).assertCountEquals(0)
    }

    @Test fun pendingLanguageConflictNoticeTellsOwnerNothingWasChanged() {
        val state = NormalAccountUiState(true, account = NormalAccountState("real.owner@gmail.com"), sync = NormalSyncState("owner-a", true, notice = NormalSyncNotice.CREATE_PENDING_LANGUAGE, pendingCreate = true))
        compose.setContent { NormalAccountScreen(state, Events()) {} }
        compose.onNodeWithText(text(R.string.normal_account_create_pending_language)).assertExists()
        compose.onAllNodesWithText(text(R.string.normal_account_sync_ready)).assertCountEquals(0)
        assertEquals(null, labelWords.find(text(R.string.normal_account_create_pending_language)))
    }

    @Test fun pendingNoticesExistInBothIndonesianAndEnglish() {
        val base = ApplicationProvider.getApplicationContext<android.content.Context>()
        fun localized(tag: String, id: Int): String {
            val configuration = android.content.res.Configuration(base.resources.configuration)
            configuration.setLocale(java.util.Locale.forLanguageTag(tag))
            return base.createConfigurationContext(configuration).getString(id)
        }
        for (id in listOf(R.string.normal_account_create_pending, R.string.normal_account_create_pending_language)) {
            val en = localized("en", id); val ind = localized("id", id)
            assertEquals(false, en == ind)
            assertEquals(null, labelWords.find(en)); assertEquals(null, labelWords.find(ind))
        }
        assertEquals(true, localized("en", R.string.normal_account_create_pending).startsWith("An earlier profile creation"))
        assertEquals(true, localized("id", R.string.normal_account_create_pending).startsWith("Pembuatan profil sebelumnya"))
    }

    @Test fun ownerRemoteHubDoesNotOfferRegistration() {
        compose.setContent { NormalAccountScreen(NormalAccountUiState(true, emailActionsAllowed = false), Events()) {} }
        compose.onNodeWithText(text(R.string.normal_account_sign_in)).assertExists()
        compose.onAllNodesWithText(text(R.string.normal_account_register)).assertCountEquals(0)
    }

    @Test fun ownerRemoteSignInDoesNotOfferRecoveryOrConfirmation() {
        compose.setContent { NormalAccountScreen(NormalAccountUiState(true, NormalAccountMode.SIGN_IN, emailActionsAllowed = false), Events()) {} }
        compose.onAllNodesWithText(text(R.string.normal_account_forgot)).assertCountEquals(0)
        compose.onAllNodesWithText(text(R.string.normal_account_enter_code)).assertCountEquals(0)
    }

    @Test fun ownerRemoteCannotRenderAStaleRegistrationMode() {
        compose.setContent { NormalAccountScreen(NormalAccountUiState(true, NormalAccountMode.SIGN_UP, emailActionsAllowed = false), Events()) {} }
        compose.onNodeWithText(text(R.string.normal_account_sign_in)).assertExists()
        compose.onAllNodesWithText(text(R.string.normal_account_register)).assertCountEquals(0)
        compose.onAllNodesWithText(text(R.string.normal_account_email)).assertCountEquals(0)
    }

    @Test fun defaultBuildHasNoSettingsAccountEntry() {
        compose.setContent { NormalAccountSettingsEntry {} }
        compose.onAllNodesWithText(text(R.string.normal_account_open)).assertCountEquals(0)
    }
}
