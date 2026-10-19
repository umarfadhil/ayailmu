package id.petalytix.ayailmu.feature.synclab

import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import dagger.hilt.android.lifecycle.HiltViewModel
import id.petalytix.ayailmu.R
import id.petalytix.ayailmu.core.design.components.AyaButton
import id.petalytix.ayailmu.core.design.components.AyaSecondaryButton
import id.petalytix.ayailmu.core.sync.Learner
import id.petalytix.ayailmu.feature.consent.ConsentRoute
import id.petalytix.ayailmu.feature.session.SessionRoute
import id.petalytix.ayailmu.navigation.AyaRoute
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

@Serializable
private data object SyncLabHub

@HiltViewModel
internal class SyncLabViewModel @Inject constructor(private val repository: SyncLabRepository, private val auth: SyncLabAuth) : ViewModel() {
    private val busy = MutableStateFlow(false)
    val state = combine(repository.state, busy) { s, b -> s.copy(busy = b) }.stateIn(viewModelScope, SharingStarted.Eagerly, SyncLabState())
    private fun action(block: suspend () -> Unit) {
        if (busy.value) return
        busy.value = true
        viewModelScope.launch {
            try { block() } catch (e: Exception) { repository.failed(e) } finally { busy.value = false }
        }
    }
    fun login(launch: (Intent) -> Unit) {
        if (busy.value) return
        busy.value = true
        auth.begin({ intent -> busy.value = false; launch(intent) }, { busy.value = false; viewModelScope.launch { repository.failed() } })
    }
    fun complete(intent: Intent?) {
        busy.value = true
        auth.complete(intent, { token -> busy.value = false; action { repository.login(token) } }, { busy.value = false; viewModelScope.launch { repository.failed() } })
    }
    fun logout() = action { auth.invalidate(); repository.logout() }
    fun create() = action { repository.create() }
    fun select(learner: Learner) = action { repository.select(learner) }
    fun refresh() = action { repository.refresh() }
    fun enable() = action { repository.enable() }
    fun disable() = action { repository.disable() }
    fun sync() = action { repository.sync() }
    fun learn(ready: (Boolean) -> Unit) = action { ready(repository.prepareLearning()) }
}

/** This graph is compiled into syncLab only; no ordinary profile picker, purchases or real-data entry. */
@Composable
fun SyncLabApp() {
    val vm: SyncLabViewModel = hiltViewModel()
    val state by vm.state.collectAsStateWithLifecycle()
    val nav = rememberNavController()
    val login = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { vm.complete(it.data) }
    LaunchedEffect(state.owner) {
        if (state.owner == null) nav.popBackStack(SyncLabHub, inclusive = false)
    }
    NavHost(navController = nav, startDestination = SyncLabHub) {
        composable<SyncLabHub> {
            SyncLabHubScreen(state, vm, onLogin = { vm.login(login::launch) }, onLearn = {
                vm.learn { consent -> nav.navigate(if (consent) AyaRoute.Consent("arab") else AyaRoute.Session("arab")) }
            })
        }
        composable<AyaRoute.Consent> {
            Column(Modifier.fillMaxSize()) {
                Text(stringResource(R.string.sync_lab_warning), modifier = Modifier.padding(12.dp), style = MaterialTheme.typography.labelMedium)
                ConsentRoute(onAccepted = { nav.navigate(AyaRoute.Session("arab")) { popUpTo(AyaRoute.Consent("arab")) { inclusive = true } } }, onBack = { nav.popBackStack(SyncLabHub, false) })
            }
        }
        composable<AyaRoute.Session> {
            SessionRoute(onExit = { nav.popBackStack(SyncLabHub, false) }, onConsent = {
                nav.navigate(AyaRoute.Consent("arab")) { popUpTo(AyaRoute.Session("arab")) { inclusive = true } }
            })
        }
    }
}

@Composable
private fun SyncLabHubScreen(state: SyncLabState, vm: SyncLabViewModel, onLogin: () -> Unit, onLearn: () -> Unit) {
    var syntheticAck by rememberSaveable { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.sync_lab_title), style = MaterialTheme.typography.headlineMedium)
        Text(stringResource(R.string.sync_lab_warning))
        Text(stringResource(state.notice), style = MaterialTheme.typography.bodyMedium)
        Row { Checkbox(checked = syntheticAck, onCheckedChange = { syntheticAck = it }, enabled = !state.busy); Text(stringResource(R.string.sync_lab_ack)) }
        AyaButton(text = stringResource(R.string.sync_lab_login), onClick = onLogin, enabled = syntheticAck && !state.busy)
        if (state.owner != null) {
            if (state.authenticated) {
                AyaSecondaryButton(text = stringResource(R.string.sync_lab_refresh), onClick = vm::refresh, enabled = !state.busy)
                AyaSecondaryButton(text = stringResource(R.string.sync_lab_new), onClick = vm::create, enabled = !state.busy)
            }
            state.learners.forEach { learner ->
                AyaSecondaryButton(text = stringResource(R.string.sync_lab_choose, learner.id.takeLast(8)), onClick = { vm.select(learner) }, enabled = !state.busy)
            }
            if (state.selected != null) {
                Text(stringResource(R.string.sync_lab_local_only))
                AyaButton(text = stringResource(R.string.sync_lab_learn), onClick = onLearn, enabled = !state.busy)
                Text(stringResource(R.string.sync_lab_opt_in_detail))
                if (!state.enabled) AyaSecondaryButton(text = stringResource(R.string.sync_lab_opt_in), onClick = vm::enable, enabled = state.authenticated && syntheticAck && !state.busy)
                else AyaSecondaryButton(text = stringResource(R.string.sync_lab_disable), onClick = vm::disable, enabled = !state.busy)
                if (state.withdrawalPending) Text(stringResource(R.string.sync_lab_withdraw_pending))
                Text(stringResource(R.string.sync_lab_pending, state.pending))
                Text(stringResource(R.string.sync_lab_remote, state.remoteAnswers, state.learnedSkills))
                AyaSecondaryButton(text = stringResource(R.string.sync_lab_sync), onClick = vm::sync, enabled = state.authenticated && !state.busy)
            }
            AyaSecondaryButton(text = stringResource(R.string.sync_lab_logout), onClick = vm::logout, enabled = !state.busy)
        }
    }
}
