import Foundation
/// Ephemeral transport. Redirects are cancelled before credentials can be forwarded.
public final class URLSessionTransport: NSObject, HTTPTransport, URLSessionTaskDelegate, @unchecked Sendable {
    private var session: URLSession!
    public override init() {
        super.init(); let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 10; config.timeoutIntervalForResource = 20
        config.httpCookieStorage = nil; config.urlCache = nil; config.httpShouldSetCookies = false
        session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }
    public func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
    public func send(_ request: URLRequest) async throws -> HTTPReply {
        let (bytes,response) = try await session.bytes(for: request, delegate: self)
        guard let http = response as? HTTPURLResponse else { throw AccountError.invalidResponse }
        if (300...399).contains(http.statusCode) { throw AccountError.redirect }
        var data = Data(); for try await byte in bytes { guard data.count < 4_194_304 else { throw AccountError.tooLarge }; data.append(byte) }
        return HTTPReply(status: http.statusCode, data: data)
    }
}
public final class AccountAPI {
    public let config: Configuration; private let transport: HTTPTransport
    public init(config: Configuration, transport: HTTPTransport) { self.config = config; self.transport = transport }
    public func request(_ method: String, _ path: String, body: [String: Any]? = nil, token: String? = nil, errorField: String = "error_code", maxBodyBytes:Int = 16384, maxResponseBytes:Int = 1048576) async throws -> Data {
        // Paths are internal constants; prevent future callers from introducing a second origin.
        guard path.hasPrefix("/"), !path.hasPrefix("//"), !path.contains("#"), let url = URL(string: config.origin + path), url.host == URL(string:config.origin)?.host, url.port == URL(string:config.origin)?.port else { throw AccountError.configuration }
        var request = URLRequest(url:url); request.httpMethod = method; request.timeoutInterval = 10; request.setValue("application/json",forHTTPHeaderField:"Accept")
        if let token { guard !token.isEmpty, token.count <= 16384, !token.unicodeScalars.contains(where: { $0.value == 0 || $0.value == 10 || $0.value == 13 }) else { throw AccountError.input }; request.setValue("Bearer " + token,forHTTPHeaderField:"Authorization") }
        if let body { let data = try JSONSerialization.data(withJSONObject:body,options:[.sortedKeys]); guard maxBodyBytes <= 1048576, data.count <= maxBodyBytes else { throw AccountError.input }; request.httpBody = data; request.setValue("application/json",forHTTPHeaderField:"Content-Type") }
        let reply = try await transport.send(request)
        guard maxResponseBytes <= 4194304, reply.data.count <= maxResponseBytes else { throw AccountError.tooLarge }
        if (300...399).contains(reply.status) { throw AccountError.redirect }
        guard (200...299).contains(reply.status) else {
            let object = (try? JSONSerialization.jsonObject(with:reply.data)) as? [String: Any]
            let raw = object?[errorField] as? String ?? "request_failed"
            let code = raw.range(of:"^[a-z_]{1,80}$",options:.regularExpression) != nil ? raw : "request_failed"
            throw AccountError.http(reply.status, code)
        }; return reply.data
    }
    public static func emailValid(_ value: String) -> Bool { value.count <= 254 && value.contains("@") && !value.contains(where: { $0.isWhitespace }) }
    public static func passwordValid(_ value: String) -> Bool { (12...256).contains(value.count) && !value.unicodeScalars.contains(where: { $0.value == 0 || $0.value == 10 || $0.value == 13 }) }
    public static func codeValid(_ value: String) -> Bool { value.range(of:"^[0-9]{6}$",options:.regularExpression) != nil }
    private func credentials(_ email:String,_ password:String) throws { guard Self.emailValid(email), Self.passwordValid(password) else { throw AccountError.input } }
    private func session(_ data:Data) throws -> AuthSession {
        let s = try JSONDecoder().decode(AuthSession.self,from:data)
        guard !s.accessToken.isEmpty, s.accessToken.count <= 16384, !s.accessToken.unicodeScalars.contains(where:{$0.value == 0 || $0.value == 10 || $0.value == 13}), !s.refreshToken.isEmpty, s.refreshToken.count <= 4096, (1...86400).contains(s.expiresIn), s.tokenType.lowercased() == "bearer", !s.user.id.isEmpty else { throw AccountError.invalidResponse }; return s
    }
    public func signIn(email:String,password:String) async throws -> AuthSession { try credentials(email,password); return try session(await request("POST","/token?grant_type=password",body:["email":email,"password":password])) }
    public func signUp(email:String,password:String) async throws { try credentials(email,password); _ = try await request("POST","/signup",body:["email":email,"password":password]) }
    public func verify(email:String,code:String,type:String) async throws -> AuthSession { guard Self.emailValid(email), Self.codeValid(code), ["signup","recovery"].contains(type) else { throw AccountError.input }; return try session(await request("POST","/verify",body:["email":email,"token":code,"type":type])) }
    public func recover(email:String) async throws { guard Self.emailValid(email) else { throw AccountError.input }; _ = try await request("POST","/recover",body:["email":email]) }
    public func resend(email:String) async throws { guard Self.emailValid(email) else { throw AccountError.input }; _ = try await request("POST","/resend",body:["email":email,"type":"signup"]) }
    public func refresh(_ token:String) async throws -> AuthSession { guard !token.isEmpty, token.count <= 4096 else { throw AccountError.input }; return try session(await request("POST","/token?grant_type=refresh_token",body:["refresh_token":token])) }
    public func user(_ token:String) async throws -> AuthUser { try JSONDecoder().decode(AuthUser.self,from:await request("GET","/user",token:token)) }
    public func password(_ password:String, token:String) async throws -> AuthUser { guard Self.passwordValid(password) else { throw AccountError.input }; return try JSONDecoder().decode(AuthUser.self,from:await request("PUT","/user",body:["password":password],token:token)) }
    public func logout(_ token:String) async throws { _ = try await request("POST","/logout?scope=local",token:token) }
    public func owner(_ token:String, activate:Bool) async throws -> String {
        let data = try await request(activate ? "POST":"GET","/v1/account",body:activate ? ["declaration_version":config.declarationVersion,"adult_confirmed":true,"synthetic":false]:nil,token:token)
        struct Owner: Decodable { let account_id:String }; let id = try JSONDecoder().decode(Owner.self,from:data).account_id
        guard !id.isEmpty else { throw AccountError.invalidResponse }; return id
    }
}
