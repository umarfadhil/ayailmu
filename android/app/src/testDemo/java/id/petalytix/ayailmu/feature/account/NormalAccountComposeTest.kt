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

    @Test fun defaultBuildHasNoSettingsAccountEntry() {
        compose.setContent { NormalAccountSettingsEntry {} }
        compose.onAllNodesWithText(text(R.string.normal_account_open)).assertCountEquals(0)
    }
}
