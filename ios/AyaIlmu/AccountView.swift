import SwiftUI
import AyaIlmuCore
private typealias AccountMode = AccountFormMode
private enum AccountField: Hashable { case email, password, confirmation, code }
struct AccountView: View {
    @StateObject private var model = AccountModel()
    @State private var mode = AccountMode.login
    @State private var email = ""; @State private var password = ""; @State private var code = ""; @State private var adult = false
    @State private var confirmPassword = ""
    @State private var submitting = false
    @FocusState private var focused: AccountField?
    private let teal = Color(red:0.08,green:0.39,blue:0.36)
    var body: some View {
        NavigationStack {
            ScrollViewReader { scroll in
            ScrollView {
                VStack(alignment:.leading,spacing:24) {
                    HStack(spacing:12) {
                        Image(systemName:"leaf.fill").font(.largeTitle).foregroundStyle(teal)
                        VStack(alignment:.leading,spacing:3) { Text("AyaIlmu").font(.largeTitle.bold()); Text("A little learning, every day").foregroundStyle(.secondary) }
                    }.padding(.top,24)
                    if let owner = model.email {
                        Label("Account",systemImage:"person.crop.circle.fill").font(.title2.bold())
                        Text(model.offline ? "Saved account: \(owner)":"Signed in as \(owner)").textSelection(.enabled)
                        accountFeedback.id("account.feedback")
                        if let capability = model.ownerSession { LearningView(session:capability).id(ObjectIdentifier(capability)) }
                        contentAvailability
                        Button("Restore session") { Task { await model.restore() } }.disabled(model.busy)
                        Button("Sign in again with password") { clearSecrets(); model.reauthenticate() }.disabled(model.busy)
                        Button("Sign out") { clearSecrets(); Task { await model.logout() } }.buttonStyle(.borderedProminent).tint(teal)
                    } else {
                        VStack(alignment:.leading,spacing:8) { Text(mode.rawValue).font(.title.bold()); Text(introduction).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true) }
                        VStack(alignment:.leading,spacing:16) {
                            TextField("Email",text:$email).textContentType(.emailAddress).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled().focused($focused, equals:.email).submitLabel(mode == .recover ? .done:.next).onSubmit { focused = mode == .confirm ? .code : mode == .recover ? nil : .password }.accessibilityIdentifier("account.email")
                            if mode == .login || mode == .signup || mode == .reset {
                                SecureField(mode == .reset ? "New password" : "Password",text:$password).textContentType(mode == .login ? .password:.newPassword).focused($focused, equals:.password).submitLabel(mode == .login ? .done:.next).onSubmit { focused = mode == .login ? nil : .confirmation }.accessibilityIdentifier("account.password")
                                Text("Use 12–256 characters.").font(.caption).foregroundStyle(.secondary)
                            }
                            if mode == .signup || mode == .reset { SecureField("Confirm password",text:$confirmPassword).textContentType(.newPassword).focused($focused, equals:.confirmation).submitLabel(mode == .reset ? .next:.done).onSubmit { focused = mode == .reset ? .code : nil }.accessibilityIdentifier("account.confirmPassword") }
                            if mode == .confirm || mode == .reset { TextField("6-digit code",text:$code).keyboardType(.numberPad).textContentType(.oneTimeCode).focused($focused, equals:.code).accessibilityIdentifier("account.code") }
                        }.textFieldStyle(.roundedBorder).disabled(model.busy || submitting)
                        if mode == .login || mode == .signup || mode == .confirm { Toggle("I declare that I am an adult or guardian account owner. This is not age verification.",isOn:$adult).font(.subheadline).tint(teal).disabled(model.busy || submitting) }
                        if !validationMessages.isEmpty { VStack(alignment:.leading,spacing:4) { ForEach(validationMessages,id:\.self) { Text("• " + $0) } }.font(.caption).foregroundStyle(.secondary).accessibilityIdentifier("account.requirements") }
                        VStack(alignment:.leading,spacing:12) {
                            Button { focused = nil; submit() } label: { HStack { Spacer(); if operationInProgress { ProgressView().tint(.white) }; Text(operationInProgress ? progressTitle : actionTitle).fontWeight(.semibold); Spacer() }.padding(.vertical,7) }.buttonStyle(.borderedProminent).tint(teal).disabled(operationInProgress || !valid).accessibilityIdentifier("account.submit")
                            accountFeedback
                        }.id("account.feedback")
                        #if !OWNER_SIGN_IN_ONLY
                        if mode == .confirm { Button("Resend code") { Task { _ = await model.run(progress:"Sending a new code…") { try await $0.resend(email:email); return "If a resend is available, a new code will arrive in the inbox." } } }.disabled(model.busy || submitting || !AccountAPI.emailValid(email)) }
                        VStack(alignment:.leading,spacing:14) {
                            ForEach(AccountMode.allCases.filter { $0 != mode },id:\.self) { destination in Button(destination.rawValue) { model.cancel(); mode = destination; focused = nil; clearSecrets(); adult = false; model.message = "" }.disabled(model.busy || submitting) }
                        }.tint(teal)
                        #endif
                        contentAvailability
                    }
                }.padding(24).frame(maxWidth:560).frame(maxWidth:.infinity)
            }.scrollDismissesKeyboard(.interactively).background(Color(.systemBackground)).navigationTitle("Account").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItemGroup(placement:.keyboard) { Spacer(); Button("Done") { focused = nil } } }
            .onChange(of: operationInProgress) { _, active in
                if (active && submitting) || (!active && !model.message.isEmpty) { withAnimation { scroll.scrollTo("account.feedback",anchor:.center) } }
            }
            .onChange(of: model.message) { _, value in
                if !value.isEmpty { withAnimation { scroll.scrollTo("account.feedback",anchor:.center) } }
            }
            }
        }.task { await model.restore() }
    }
    private var operationInProgress: Bool { model.busy || submitting }
    private var progressTitle: String { model.busy ? model.progress : mode.progressTitle }
    @ViewBuilder private var accountFeedback: some View {
        if operationInProgress {
            Text(progressTitle).font(.callout).foregroundStyle(.secondary).accessibilityIdentifier("account.progress")
        } else if !model.message.isEmpty {
            Text(model.message).font(.callout).fixedSize(horizontal:false,vertical:true).padding(16).frame(maxWidth:.infinity,alignment:.leading).background(Color(.secondarySystemBackground),in:RoundedRectangle(cornerRadius:16)).accessibilityIdentifier("account.message")
        }
    }
    private var contentAvailability: some View { VStack(alignment:.leading,spacing:8) { Label("Learning",systemImage:"book.closed").font(.headline); Text(ApprovedLessonLibrary.bundled.lessons.isEmpty ? "No lessons are available yet.":"Lessons are available after you sign in and choose a profile.").foregroundStyle(.secondary) }.padding(20).frame(maxWidth:.infinity,alignment:.leading).background(teal.opacity(0.07),in:RoundedRectangle(cornerRadius:20)) }
    private var introduction: String { switch mode { case .signup: return "For adults or guardians. Child self-registration is unavailable. After registering, open your email inbox for the confirmation code."; case .confirm: return "Enter the 6-digit code sent to your email inbox. Check spam too."; case .recover: return "If the account can be recovered, a code will be sent to that email inbox."; case .reset: return "Enter the recovery code from your inbox and a new password."; case .login: return "Sign in to your account." } }
    private var actionTitle: String { switch mode { case .confirm:return "Confirm"; case .recover:return "Send recovery code"; case .reset:return "Save new password"; default:return mode.rawValue } }
    private var validationMessages: [String] { AccountFormValidation.messages(mode:mode,email:email,password:password,confirmation:confirmPassword,code:code,adult:adult) }
    private var valid: Bool { validationMessages.isEmpty }
    private func clearSecrets() { password = ""; confirmPassword = ""; code = "" }
    private func submit() {
        guard !model.busy, valid else { return }
        guard !submitting else { return }
        submitting = true
        let target = mode
        let submittedEmail = email, submittedPassword = password, submittedCode = code, submittedAdult = adult
        Task {
        defer { submitting = false }
        #if OWNER_SIGN_IN_ONLY
        guard target == .login else { return }
        #endif
        let success = await model.run(progress:target.progressTitle) { store in
            switch target {
            case .login: try await store.signIn(email:submittedEmail,password:submittedPassword,adult:submittedAdult); return ""
            case .signup: try await store.signUp(email:submittedEmail,password:submittedPassword,adult:submittedAdult); return "Registration submitted. Open your email inbox for the confirmation code; you are not signed in yet."
            case .confirm: try await store.confirm(email:submittedEmail,code:submittedCode,adult:submittedAdult); return "Email confirmed and account signed in."
            case .recover: try await store.recover(email:submittedEmail); return "If the account can be recovered, a recovery code will arrive in the inbox."
            case .reset: try await store.reset(email:submittedEmail,code:submittedCode,password:submittedPassword); return "Password updated. Sign in again with the new password."
            }
        }
        // Keep the in-memory form on failure so a visible error can be corrected/retried.
        // Successful operations and explicit mode changes still clear secrets.
        if success {
            clearSecrets()
            if target == .signup { mode = .confirm }; if target == .recover { mode = .reset }; if target == .reset { mode = .login }
        }
    } }
}

private struct LearningView: View {
    @StateObject private var model:LearningPresentationModel
    @State private var language = "en"
    let session:OwnerSession
    private var selectedLessons:[ApprovedLesson] { model.library.lessons.filter { model.profiles.first(where:{$0.id == model.selected})?.lang == $0.language } }
    init(session:OwnerSession) { self.session = session; let model:LearningPresentationModel
        do {
            let root = try FileManager.default.url(for:.applicationSupportDirectory,in:.userDomainMask,appropriateFor:nil,create:true).appendingPathComponent("AyaIlmu",isDirectory:true)
            model = LearningPresentationModel(learning:LearningStore(session:session,journal:try SQLiteJournal(url:root.appendingPathComponent("learning.sqlite"))),core:AppSharedCore.make())
        } catch { model = LearningPresentationModel(storageFailure:true) }
        _model = StateObject(wrappedValue:model) }
    var body: some View {
        VStack(alignment:.leading,spacing:18) {
            if !session.networkVerified { Label("Offline · saved account",systemImage:"wifi.slash").foregroundStyle(.secondary) }
            Text("Profiles").font(.title2.bold())
            if model.profiles.isEmpty { Text("No saved profiles.").foregroundStyle(.secondary) }
            ForEach(model.profiles,id:\.id) { profile in
                Button { model.select(profile.id) } label: {
                    HStack { Image(systemName:model.selected == profile.id ? "checkmark.circle.fill":"person.crop.circle"); Text("Adult profile · \(profile.lang == "id" ? "Bahasa Indonesia":"English")"); Spacer() }
                }.disabled(model.busy)
            }
            Picker("Profile language",selection:$language) { Text("Bahasa Indonesia").tag("id"); Text("English").tag("en") }.pickerStyle(.segmented)
            Button("Create adult profile") { Task { await model.run { try await $0.createAdult(language:language) } } }.disabled(model.busy || !session.networkVerified)
            Button("Refresh profiles") { Task { await model.run { try await $0.loadProfiles() } } }.disabled(model.busy || !session.networkVerified)
            if let summary = model.summary {
                Divider(); Text("Progress").font(.title2.bold())
                LabeledContent("Answers saved on this device",value:String(summary.localAnswers))
                LabeledContent("Answers waiting to sync",value:String(summary.pending))
                LabeledContent("Answers restored from account",value:String(summary.remoteAnswers))
                if let progress = model.projection {
                    LabeledContent("Skills learned",value:String(progress.learned))
                    LabeledContent("Skills in practice",value:String(progress.practicing))
                    LabeledContent("Skills needing follow-up",value:String(progress.blocked))
                }
                Text(summary.enabled ? "Sync is enabled for this profile only.":"Sync is off.").font(.subheadline)
                if summary.withdrawalPending { Text("Sync is off on this device. Account withdrawal will be retried when connected.").font(.subheadline) }
                Text("Device history from before activation is not uploaded. Other local profiles are not linked automatically.").font(.footnote).foregroundStyle(.secondary)
                if summary.enabled || summary.withdrawalPending {
                    Button("Disable sync") { Task { await model.disable() } }
                } else {
                    Button("Enable sync from now on") { Task { await model.run { try await $0.enableSync(proofs:selectedLessons.map(\.proof)) } } }
                        .disabled(model.busy || !session.networkVerified || selectedLessons.isEmpty)
                }
                Button("Sync now") { Task { await model.run { try await $0.sync() } } }.disabled(model.busy || !session.networkVerified || !summary.enabled && !summary.withdrawalPending)
            }
            if model.core.isAvailable, let learning = model.learning {
                ForEach(selectedLessons) { course in
                    NavigationLink(course.title) { LessonView(lesson:course,learning:learning,core:model.core,onProgressChanged:{ model.refresh() }) }
                }
            }
            if model.busy { ProgressView() }
            if !model.message.isEmpty { Text(model.message).font(.callout).foregroundStyle(.secondary).accessibilityIdentifier("learning.message") }
        }.task { if session.networkVerified { await model.run { try await $0.loadProfiles() } } }
    }
}

private struct LessonView: View {
    let lesson:ApprovedLesson; let learning:LearningStore; let core:SharedLessonCore
    let onProgressChanged:() -> Void
    @State private var session:LessonSession?; @State private var number = ""; @State private var message = ""; @State private var revision = 0
    @State private var sliderValue:Double?; @State private var sequence:[String] = []; @State private var pairings:[String:String] = [:]
    var body: some View {
        ScrollView {
            VStack(alignment:.leading,spacing:20) {
                if let screen = session?.currentScreen { Text(screen.title).font(.title2.bold()); ForEach(screen.body,id:\.self) { Text($0) } }
                if let item = session?.current { question(item).id(item.id) }
                ForEach(session?.lastFeedback ?? [],id:\.self) { Text($0) }
                if session?.canAdvance == true { Button("Continue") { advance() }.buttonStyle(.borderedProminent) }
                else if session != nil && session?.current == nil { Label("Session saved",systemImage:"checkmark.circle") }
                if !message.isEmpty { Text(message).foregroundStyle(.secondary) }
            }.padding(24).id(revision)
        }.navigationTitle(lesson.title).onDisappear(perform:onProgressChanged).task {
            do { session = try LessonSession(lesson:lesson,learning:learning,core:core) }
            catch { message = "This lesson is not available. Your saved progress has not changed." }
        }
    }
    @ViewBuilder private func question(_ item:LessonItem) -> some View {
        Text(item.prompt).font(.title2.bold())
        ForEach(item.help,id:\.self) { Text($0).foregroundStyle(.secondary) }
        if ["choose","true_false"].contains(item.type) {
            ForEach(item.options,id:\.id) { option in Button(option.title) { submit(["kind":"choice","option_id":option.id]) }.buttonStyle(.bordered) }
        } else if item.type == "number_input" {
            TextField("Answer",text:$number).keyboardType(.decimalPad).textFieldStyle(.roundedBorder)
            Button("Submit answer") { guard let value = LocalizedNumberInput.parse(number,language:lesson.language) else { message = "Enter a number to continue."; return }; submit(["kind":"number","value":value]) }.disabled(LocalizedNumberInput.parse(number,language:lesson.language) == nil)
        } else if item.type == "estimate_slider",let range = item.slider {
            Slider(value:Binding(get:{sliderValue ?? range.min},set:{sliderValue = $0}),in:range.min...range.max,step:range.step)
            Text((sliderValue ?? range.min).formatted(.number.locale(Locale(identifier:lesson.language == "id" ? "id_ID":"en_US"))))
            Button("Submit estimate") { guard let value = sliderValue else { return }; submit(["kind":"number","value":value]) }.disabled(sliderValue == nil)
        } else if ["tiles","fill_blank","order"].contains(item.type) {
            ForEach(item.options,id:\.id) { option in Button(option.title) { if let index = sequence.firstIndex(of:option.id) { sequence.remove(at:index) } else { sequence.append(option.id) } }.buttonStyle(.bordered).tint(sequence.contains(option.id) ? .secondary:.accentColor) }
            Text(sequence.compactMap{id in item.options.first{$0.id == id}?.title}.joined(separator:" → "))
            Button("Submit answer") { submit(["kind":"sequence","sequence":sequence]) }.disabled(sequence.isEmpty)
        } else if item.type == "match_pairs" {
            ForEach(item.leftIDs,id:\.self) { left in
                Picker(item.options.first{$0.id == left}?.title ?? left,selection:Binding(get:{pairings[left] ?? ""},set:{pairings[left] = $0})) {
                    Text("Choose a match").tag("")
                    ForEach(item.rightIDs,id:\.self) { right in Text(item.options.first{$0.id == right}?.title ?? right).tag(right).disabled(pairings.contains{$0.key != left && $0.value == right}) }
                }
            }
            Button("Submit matches") { submit(["kind":"pairs","pairs":item.leftIDs.compactMap{left in pairings[left].map{["left":left,"right":$0]}}]) }.disabled(item.leftIDs.contains{pairings[$0] == nil || pairings[$0] == ""} || Set(pairings.values).count != item.leftIDs.count)
        } else if ["info_card","mini_reading"].contains(item.type) {
            if let body = item.modelAnswer { Text(body) }
            Button("Continue") { submit(["kind":"choice","option_id":"seen"]) }
        }
        if !["info_card","mini_reading"].contains(item.type) { Button("I don’t know yet") { submit(["kind":"dont_know"]) } }
    }
    private func resetDraft() { number = ""; sliderValue = nil; sequence = []; pairings = [:]; message = ""; revision += 1 }
    private func submit(_ response:[String:Any]) {
        do { let raw = String(data:try JSONSerialization.data(withJSONObject:response,options:.sortedKeys),encoding:.utf8)!; try session?.submit(responseJSON:raw); resetDraft() }
        catch { message = "Your answer could not be saved. Please retry before continuing." }
    }
    private func advance() { do { try session?.advance(); resetDraft() } catch { message = "Your progress could not be saved. Please retry before continuing." } }
}
