package id.petalytix.ayailmu.feature.synclab

import android.content.Context
import android.content.Intent
import android.net.Uri
import dagger.hilt.android.qualifiers.ApplicationContext
import java.net.HttpURLConnection
import java.net.Proxy
import java.net.URL
import javax.inject.Inject
import javax.inject.Singleton
import net.openid.appauth.AppAuthConfiguration
import net.openid.appauth.AuthorizationException
import net.openid.appauth.AuthorizationRequest
import net.openid.appauth.AuthorizationResponse
import net.openid.appauth.AuthorizationService
import net.openid.appauth.AuthorizationServiceConfiguration
import net.openid.appauth.ResponseTypeValues
import net.openid.appauth.connectivity.ConnectionBuilder

/** Lab-only code+PKCE via external browser. No credentials/token serialization or WebView. */
@Singleton
class SyncLabAuth @Inject constructor(@ApplicationContext context: Context) {
    private val connection = ConnectionBuilder { uri ->
        val url = URL(uri.toString())
        require(url.protocol == "http" && url.host == "127.0.0.1" && url.port == 8286 && url.path.startsWith("/realms/umar-integration/"))
        (url.openConnection(Proxy.NO_PROXY) as HttpURLConnection).apply { instanceFollowRedirects = false; connectTimeout = 5_000; readTimeout = 5_000 }
    }
    private val configuration = AppAuthConfiguration.Builder().setConnectionBuilder(connection).setSkipIssuerHttpsCheck(true).build()
    private val service = AuthorizationService(context, configuration)
    private var generation = 0L
    private var pending: AuthorizationRequest? = null

    fun begin(ready: (Intent) -> Unit, failed: () -> Unit) {
        val attempt = ++generation
        pending = null
        AuthorizationServiceConfiguration.fetchFromIssuer(Uri.parse(ISSUER), { config, error ->
            if (attempt != generation) return@fetchFromIssuer
            if (error != null || config == null || config.authorizationEndpoint.toString() != "$ISSUER/protocol/openid-connect/auth" || config.tokenEndpoint.toString() != "$ISSUER/protocol/openid-connect/token") { failed(); return@fetchFromIssuer }
            val request = authorizationRequest(config)
            pending = request
            ready(service.getAuthorizationRequestIntent(request))
        }, connection)
    }
    fun complete(intent: Intent?, token: (String) -> Unit, failed: () -> Unit) {
        val request = pending
        val attempt = generation
        val response = intent?.let(AuthorizationResponse::fromIntent)
        val error = intent?.let(AuthorizationException::fromIntent)
        pending = null
        if (request == null || response == null || error != null || response.request.state != request.state) { failed(); return }
        service.performTokenRequest(response.createTokenExchangeRequest()) { result, failure ->
            if (attempt != generation) return@performTokenRequest
            val access = result?.accessToken
            if (failure != null || access.isNullOrBlank()) failed() else token(access)
        }
    }
    fun invalidate() { generation++; pending = null }
    companion object {
        const val ISSUER = "http://127.0.0.1:8286/realms/umar-integration"
        const val REDIRECT = "id.petalytix.ayailmu.synclab:/oauth2redirect"
        internal fun authorizationRequest(config: AuthorizationServiceConfiguration): AuthorizationRequest =
            AuthorizationRequest.Builder(config, "umar-native", ResponseTypeValues.CODE, Uri.parse(REDIRECT))
                .setScope("openid umar.sync").setPrompt("login").setAdditionalParameters(mapOf("max_age" to "0")).build()
    }
}
