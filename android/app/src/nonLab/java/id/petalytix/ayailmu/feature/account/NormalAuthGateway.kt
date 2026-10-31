package id.petalytix.ayailmu.feature.account

import id.petalytix.ayailmu.core.sync.AuthSession
import id.petalytix.ayailmu.core.sync.AuthUser
import id.petalytix.ayailmu.core.sync.GoTrueAuth
import javax.inject.Inject

internal interface NormalAuthGateway {
    suspend fun signUp(email: String, password: String, operationId: String)
    suspend fun signIn(email: String, password: String): AuthSession
    suspend fun verifyOtp(email: String, code: String, type: String): AuthSession
    suspend fun recover(email: String, operationId: String)
    suspend fun resend(email: String, operationId: String)
    suspend fun refresh(refreshToken: String): AuthSession
    suspend fun user(token: String): AuthUser
    suspend fun updatePassword(token: String, password: String): AuthUser
    suspend fun signOut(token: String)
}

/** The only normal-auth HTTP adapter. A disabled/malformed build has no client and cannot open a connection. */
internal class GoTrueNormalAuthGateway private constructor(config: NormalAccountConfig, clientFactory: () -> GoTrueAuth) : NormalAuthGateway {
    @Inject constructor(config: NormalAccountConfig) : this(config, { GoTrueAuth(config.authOrigin) })
    internal constructor(config: NormalAccountConfig, client: GoTrueAuth) : this(config, { client })
    private val configured = config.takeIf { it.enabled }
    private val client by lazy { checkNotNull(configured); clientFactory() }
    private fun emailApi(): GoTrueAuth {
        check(configured?.ownerSignInOnly == false) { "Email actions are unavailable in the owner-only connection" }
        return api()
    }
    private fun api(): GoTrueAuth {
        checkNotNull(configured) { "Normal account release is not approved" }
        return client
    }
    override suspend fun signUp(email: String, password: String, operationId: String) = emailApi().signUp(email, password, operationId)
    override suspend fun signIn(email: String, password: String) = api().signIn(email, password)
    override suspend fun verifyOtp(email: String, code: String, type: String) = emailApi().verifyOtp(email, code, type)
    override suspend fun recover(email: String, operationId: String) = emailApi().recover(email, operationId)
    override suspend fun resend(email: String, operationId: String) = emailApi().resend(email, operationId)
    override suspend fun refresh(refreshToken: String) = api().refresh(refreshToken)
    override suspend fun user(token: String) = api().user(token)
    override suspend fun updatePassword(token: String, password: String) = emailApi().updatePassword(token, password)
    override suspend fun signOut(token: String) = api().signOut(token)
}
