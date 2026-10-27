import Foundation
public struct Configuration: Sendable {
    public let origin: String
    public let declarationVersion: String
    public init(origin: String, allowedOrigins: Set<String>, declarationVersion: String) throws {
        guard let c = URLComponents(string: origin), c.scheme == "https", let host = c.host, host == host.lowercased(), c.user == nil, c.password == nil, c.path.isEmpty, c.query == nil, c.fragment == nil, c.url?.absoluteString == origin, allowedOrigins.contains(origin), !declarationVersion.isEmpty else { throw AccountError.configuration }
        self.origin = origin; self.declarationVersion = declarationVersion
    }
}
public enum AccountError: Error, CustomStringConvertible, LocalizedError {
    case configuration, input, invalidResponse, identity, storage, superseded, redirect, tooLarge
    case http(Int, String)
    public var description: String {
        switch self {
        case .configuration: return "The account service configuration is invalid."
        case .input: return "Enter a valid email, a password of 12–256 characters, and a six-digit code where requested. Confirm the owner declaration to continue."
        case .identity: return "Your account could not be verified. Sign in again."
        case .storage: return "Secure storage failed. Please try again."
        case .superseded: return "Account operation cancelled."
        case .http(let status, let code):
            if status == 429 { return "Too many attempts. Please wait before trying again." }
            if code == "email_not_confirmed" { return "Confirm your email before signing in." }
            if status == 400 || status == 401 { return "The credentials or code were not accepted. Please check them and try again." }
            return "The account service could not complete this request. Please try again."
        default: return "The account service response could not be accepted. Please try again."
        }
    }
    public var errorDescription: String? { description }
}
