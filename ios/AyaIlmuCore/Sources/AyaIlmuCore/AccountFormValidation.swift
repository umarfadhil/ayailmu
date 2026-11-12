public enum AccountFormMode: String, CaseIterable {
    case login = "Sign in", signup = "Create account", confirm = "Confirm email", recover = "Forgot password", reset = "Set a new password"
    public var progressTitle: String {
        switch self {
        case .login: return "Signing in…"
        case .signup: return "Creating account…"
        case .confirm: return "Confirming email…"
        case .recover: return "Sending recovery code…"
        case .reset: return "Saving new password…"
        }
    }
}
public enum AccountFormValidation {
    public static func messages(mode: AccountFormMode, email: String, password: String, confirmation: String, code: String, adult: Bool) -> [String] {
        var messages: [String] = []
        if !AccountAPI.emailValid(email) { messages.append("Enter a valid email address.") }
        if [.login, .signup, .reset].contains(mode) && !AccountAPI.passwordValid(password) { messages.append("Use a password of 12–256 characters without line breaks.") }
        if [.signup, .reset].contains(mode) && (confirmation.isEmpty || password != confirmation) { messages.append("Passwords must match.") }
        if [.confirm, .reset].contains(mode) && !AccountAPI.codeValid(code) { messages.append("Enter the 6-digit code.") }
        if [.login, .signup, .confirm].contains(mode) && !adult { messages.append("Confirm the adult or guardian declaration.") }
        return messages
    }
}
