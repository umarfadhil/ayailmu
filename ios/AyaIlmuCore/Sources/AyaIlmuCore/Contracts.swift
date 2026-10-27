import Foundation
public struct AuthUser: Codable, Equatable, Sendable {
    public let id: String; public let email: String; public let emailConfirmedAt: String?
    enum CodingKeys: String, CodingKey { case id,email; case emailConfirmedAt = "email_confirmed_at" }
}
public struct AuthSession: Codable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    public let accessToken: String; public let refreshToken: String; public let expiresIn: Int; public let tokenType: String; public let user: AuthUser
    enum CodingKeys: String, CodingKey { case user; case accessToken = "access_token", refreshToken = "refresh_token", expiresIn = "expires_in", tokenType = "token_type" }
    public var description: String { "AuthSession(redacted)" }; public var debugDescription: String { description }
}
public struct SavedSession: Codable, Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    public let session: AuthSession; public let accountID: String; public let origin: String
    public var description: String { "SavedSession(redacted)" }; public var debugDescription: String { description }
}
public protocol SessionVault: AnyObject { func read() throws -> SavedSession?; func write(_ value: SavedSession) throws; func delete() throws }
public struct HTTPReply: Sendable { public let status: Int; public let data: Data; public init(status: Int, data: Data) { self.status = status; self.data = data } }
public protocol HTTPTransport { func send(_ request: URLRequest) async throws -> HTTPReply }
