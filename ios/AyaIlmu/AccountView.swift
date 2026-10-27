import SwiftUI
import AyaIlmuCore
private enum AccountMode: String, CaseIterable { case login = "Sign in", signup = "Create account", confirm = "Confirm email", recover = "Forgot password", reset = "Set a new password" }
struct AccountView: View {
    @StateObject private var model = AccountModel()
    @State private var mode = AccountMode.login
    @State private var email = ""; @State private var password = ""; @State private var code = ""; @State private var adult = false
    @FocusState private var focused: Bool
    private let teal = Color(red:0.08,green:0.39,blue:0.36)
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment:.leading,spacing:24) {
                    HStack(spacing:12) {
                        Image(systemName:"leaf.fill").font(.largeTitle).foregroundStyle(teal)
                        VStack(alignment:.leading,spacing:3) { Text("AyaIlmu").font(.largeTitle.bold()); Text("A little learning, every day").foregroundStyle(.secondary) }
                    }.padding(.top,24)
                    if let owner = model.email {
                        Label("Owner account",systemImage:"person.crop.circle.fill").font(.title2.bold())
                        Text("Signed in as \(owner)").textSelection(.enabled)
                        contentAvailability
                        Button("Sign out") { Task { await model.logout() } }.buttonStyle(.borderedProminent).tint(teal)
                    } else {
                        VStack(alignment:.leading,spacing:8) { Text(mode.rawValue).font(.title.bold()); Text(introduction).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true) }
                        VStack(alignment:.leading,spacing:16) {
                            TextField("Email",text:$email).textContentType(.emailAddress).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("account.email")
                            if mode == .login || mode == .signup || mode == .reset {
                                SecureField(mode == .reset ? "New password" : "Password",text:$password).textContentType(mode == .login ? .password:.newPassword).accessibilityIdentifier("account.password")
                                Text("Use 12–256 characters.").font(.caption).foregroundStyle(.secondary)
                            }
                            if mode == .confirm || mode == .reset { TextField("6-digit code",text:$code).keyboardType(.numberPad).textContentType(.oneTimeCode) }
                        }.textFieldStyle(.roundedBorder)
                        if mode == .login || mode == .signup || mode == .confirm { Toggle("I declare that I am an adult or guardian account owner. This is not age verification.",isOn:$adult).font(.subheadline).tint(teal) }
                        Button { focused = false; submit() } label: { HStack { Spacer(); if model.busy { ProgressView().tint(.white) }; Text(actionTitle).fontWeight(.semibold); Spacer() }.padding(.vertical,7) }.buttonStyle(.borderedProminent).tint(teal).disabled(model.busy || !valid)
                        if mode == .confirm { Button("Resend code") { Task { _ = await model.run { try await $0.resend(email:email); return "If a resend is available, a new code will arrive in the inbox." } } }.disabled(model.busy) }
                        VStack(alignment:.leading,spacing:14) {
                            ForEach(AccountMode.allCases.filter { $0 != mode },id:\.self) { destination in Button(destination.rawValue) { model.cancel(); mode = destination; password = ""; code = ""; adult = false; model.message = "" }.disabled(model.busy) }
                        }.tint(teal)
                        contentAvailability
                    }
                    if !model.message.isEmpty { Text(model.message).font(.callout).padding(16).frame(maxWidth:.infinity,alignment:.leading).background(Color(.secondarySystemBackground),in:RoundedRectangle(cornerRadius:16)).accessibilityIdentifier("account.message") }
                }.padding(24).frame(maxWidth:560).frame(maxWidth:.infinity)
            }.background(Color(.systemBackground)).navigationTitle("Owner account").navigationBarTitleDisplayMode(.inline)
        }.task { await model.restore() }
    }
    private var contentAvailability: some View { VStack(alignment:.leading,spacing:8) { Label("Learning",systemImage:"book.closed").font(.headline); Text("No lessons are available yet.").foregroundStyle(.secondary) }.padding(20).frame(maxWidth:.infinity,alignment:.leading).background(teal.opacity(0.07),in:RoundedRectangle(cornerRadius:20)) }
    private var introduction: String { switch mode { case .signup: return "For adult or guardian owners. Child self-registration is unavailable. After registering, open your email inbox for the confirmation code."; case .confirm: return "Enter the 6-digit code sent to your email inbox. Check spam too."; case .recover: return "If the account can be recovered, a code will be sent to that email inbox."; case .reset: return "Enter the recovery code from your inbox and a new password."; case .login: return "Sign in to your owner account." } }
    private var actionTitle: String { switch mode { case .confirm:return "Confirm"; case .recover:return "Send recovery code"; case .reset:return "Save new password"; default:return mode.rawValue } }
    private var valid: Bool { AccountAPI.emailValid(email) && (!(mode == .signup || mode == .login || mode == .confirm) || adult) && (!(mode == .signup || mode == .login || mode == .reset) || AccountAPI.passwordValid(password)) && (!(mode == .confirm || mode == .reset) || AccountAPI.codeValid(code)) }
    private func submit() { Task {
        let target = mode
        let success = await model.run { store in
            switch target {
            case .login: try await store.signIn(email:email,password:password,adult:adult); return ""
            case .signup: try await store.signUp(email:email,password:password,adult:adult); return "Registration submitted. Open your email inbox for the confirmation code; you are not signed in yet."
            case .confirm: try await store.confirm(email:email,code:code,adult:adult); return "Email confirmed and account signed in."
            case .recover: try await store.recover(email:email); return "If the account can be recovered, a recovery code will arrive in the inbox."
            case .reset: try await store.reset(email:email,code:code,password:password); return "Password updated. Sign in again with the new password."
            }
        }
        password = ""; code = ""
        if success { if target == .signup { mode = .confirm }; if target == .recover { mode = .reset }; if target == .reset { mode = .login } }
    } }
}
