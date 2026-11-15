import SwiftUI
import AyaIlmuCore
private typealias AccountMode = AccountFormMode
private enum AccountField: Hashable { case email, password, confirmation, code }
/// Text that reaches the screen as a plain String (messages from AyaIlmuCore, computed titles) is looked up here;
/// literals inside SwiftUI views are localized by SwiftUI itself. English is the key, id.lproj holds Indonesian.
private func L(_ key:String) -> String { NSLocalizedString(key,comment:"") }
struct AccountView: View {
    @StateObject private var model = AccountModel()
    @State private var mode = AccountMode.login
    @State private var email = ""; @State private var password = ""; @State private var code = ""; @State private var adult = false
    @State private var confirmPassword = ""
    @State private var submitting = false
    @State private var confirmAccountDeletion = false
    @State private var deletingOwner:OwnerSession?
    @State private var showAccount = false
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
                    deletionRecovery
                    if let owner = model.email {
                        accountFeedback.id("account.feedback")
                        if let capability = model.ownerSession {
                            Text("These are your account’s profiles. Profiles made without an account stay on this device and come back when you sign out.").font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true)
                            LearningView(session:capability).id(ObjectIdentifier(capability))
                        }
                        VStack(alignment:.leading,spacing:14) {
                            Label("Account",systemImage:"person.crop.circle.fill").font(.title2.bold())
                            Text(model.offline ? "Saved account: \(owner)":"Signed in as \(owner)").foregroundStyle(.secondary).textSelection(.enabled)
                            if model.ownerSession == nil || model.offline { Button("Reconnect") { Task { await model.restore() } }.disabled(model.busy) }
                            Button("Sign in again with password") { clearSecrets(); model.reauthenticate() }.disabled(model.busy)
                            Button("Sign out") { clearSecrets(); Task { await model.logout() } }.disabled(model.deletionBusy).buttonStyle(.bordered).tint(teal)
                        }.padding(20).frame(maxWidth:.infinity,alignment:.leading).background(Color(.secondarySystemBackground),in:RoundedRectangle(cornerRadius:20))
                        VStack(alignment:.leading,spacing:8) {
                            Button("Delete entire account",role:.destructive) {
                                deletingOwner = model.ownerSession; confirmAccountDeletion = deletingOwner != nil
                            }.disabled(operationInProgress || model.offline || model.ownerSession == nil)
                            .confirmationDialog("Permanently delete this entire account?",isPresented:$confirmAccountDeletion,titleVisibility:.visible) {
                                if let expected = deletingOwner {
                                    Button("Delete my account",role:.destructive) {
                                        Task { await model.deleteAccount(expected:expected,confirmed:true); deletingOwner = nil }
                                    }
                                }
                                Button("Cancel",role:.cancel) { deletingOwner = nil }
                            } message: {
                                Text("This deletes your account and everything stored for it on our servers: all profiles, including child profiles, synced answers and consent records. It can’t be undone, and closing this screen won’t cancel it. Removing the sign-in itself can take a little longer.\n\nLessons already on this device stay here but will no longer sync; signing out or switching accounts closes access to them. We keep a minimal record of the deletion, and backups are cleared on their own schedule. You may be asked to sign in again to confirm.")
                            }
                            Text("Removes your account and its data from our servers. Learning on this device stays.").font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true)
                        }.padding(.top,8)
                    } else {
                        if let device = model.deviceSession { LearningView(session:device).id("device") } else { contentAvailability }
                        if model.accountAvailable {
                        DisclosureGroup(isExpanded:$showAccount) {
                        VStack(alignment:.leading,spacing:24) {
                        VStack(alignment:.leading,spacing:8) { Text(L(mode.rawValue)).font(.title.bold()); if !introduction.isEmpty { Text(introduction).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true) } }
                        VStack(alignment:.leading,spacing:16) {
                            TextField("Email",text:$email).textContentType(.emailAddress).keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled().focused($focused, equals:.email).submitLabel(mode == .recover ? .done:.next).onSubmit { focused = mode == .confirm ? .code : mode == .recover ? nil : .password }.accessibilityIdentifier("account.email")
                            if mode == .login || mode == .signup || mode == .reset {
                                SecureField(mode == .reset ? "New password" : "Password",text:$password).textContentType(mode == .login ? .password:.newPassword).focused($focused, equals:.password).submitLabel(mode == .login ? .done:.next).onSubmit { focused = mode == .login ? nil : .confirmation }.accessibilityIdentifier("account.password")
                                if mode != .login { Text("At least 12 characters.").font(.caption).foregroundStyle(.secondary) }
                            }
                            if mode == .signup || mode == .reset { SecureField("Confirm password",text:$confirmPassword).textContentType(.newPassword).focused($focused, equals:.confirmation).submitLabel(mode == .reset ? .next:.done).onSubmit { focused = mode == .reset ? .code : nil }.accessibilityIdentifier("account.confirmPassword") }
                            if mode == .confirm || mode == .reset { TextField("6-digit code",text:$code).keyboardType(.numberPad).textContentType(.oneTimeCode).focused($focused, equals:.code).accessibilityIdentifier("account.code") }
                        }.textFieldStyle(.roundedBorder).disabled(model.busy || submitting)
                        if mode == .login || mode == .signup || mode == .confirm { Toggle("I declare that I am an adult or guardian account owner.",isOn:$adult).font(.subheadline).tint(teal).disabled(model.busy || submitting) }
                        if !shownValidationMessages.isEmpty { VStack(alignment:.leading,spacing:4) { ForEach(shownValidationMessages,id:\.self) { Text(L($0)) } }.font(.footnote).foregroundStyle(.secondary).accessibilityIdentifier("account.requirements") }
                        VStack(alignment:.leading,spacing:12) {
                            Button { focused = nil; submit() } label: { HStack { Spacer(); if operationInProgress { ProgressView().tint(.white) }; Text(operationInProgress ? progressTitle : actionTitle).fontWeight(.semibold); Spacer() }.padding(.vertical,7) }.buttonStyle(.borderedProminent).tint(teal).disabled(operationInProgress || !valid).disabled(!model.deletionStorageReady).accessibilityIdentifier("account.submit")
                            accountFeedback
                        }.id("account.feedback")
                        #if !OWNER_SIGN_IN_ONLY
                        if mode == .confirm { Button("Resend code") { Task { _ = await model.run(progress:"Sending a new code…") { try await $0.resend(email:email); return "If a new code can be sent, it will arrive in your email." } } }.disabled(model.busy || submitting || !AccountAPI.emailValid(email)) }
                        VStack(alignment:.leading,spacing:14) {
                            ForEach(AccountMode.allCases.filter { otherModes.contains($0) },id:\.self) { destination in Button(linkTitle(destination)) { model.cancel(); mode = destination; focused = nil; clearSecrets(); adult = false; model.message = "" }.disabled(model.busy || submitting) }
                        }.tint(teal)
                        #endif
                        }.padding(.top,12)
                        } label: {
                            VStack(alignment:.leading,spacing:4) {
                                Label("Account & sync",systemImage:"person.crop.circle").font(.title2.bold())
                                Text("Optional. Lessons work without an account. Sign in to keep your progress on our servers and use it on other devices.").font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true)
                            }
                        }.tint(teal)
                        }
                    }
                }.padding(24).frame(maxWidth:560).frame(maxWidth:.infinity)
            }.scrollDismissesKeyboard(.interactively).background(Color(.systemBackground)).navigationBarTitleDisplayMode(.inline)
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
    @ViewBuilder private var deletionRecovery: some View {
        if !model.deletions.isEmpty || !model.deletionMessage.isEmpty || !model.deletionStorageReady {
            VStack(alignment:.leading,spacing:12) {
                Label("Account deletion",systemImage:"lock.shield").font(.headline)
                if !model.deletionStorageReady {
                    Button("Try again") { Task { await model.restore() } }.disabled(operationInProgress)
                }
                ForEach(model.deletions) { record in
                    Text("Request " + String(record.id.suffix(8))).font(.caption)
                    Text(L(record.receipt.map { $0.completed ? "Done: your data and sign-in account are deleted." : "Your data is deleted. The sign-in account is still being removed." } ?? "Deletion isn’t confirmed yet. Your request is saved."))
                    Button("Check deletion status") { Task { await model.checkDeletionStatus(requestID:record.id) } }.disabled(operationInProgress)

                }
                Text("You can check the status without signing in. Keep this app installed on this device until deletion finishes; the record that proves your request is stored only here.").font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true)
                if !model.deletionMessage.isEmpty { Text(L(model.deletionMessage)).font(.callout).accessibilityIdentifier("account.deletionStatus") }
            }.padding(16).background(Color(.secondarySystemBackground),in:RoundedRectangle(cornerRadius:16))
        }
    }
    private var operationInProgress: Bool { model.busy || submitting || model.deletionBusy }
    private var progressTitle: String { L(model.deletionBusy ? "Checking account deletion…" : model.busy ? model.progress : mode.progressTitle) }
    @ViewBuilder private var accountFeedback: some View {
        if operationInProgress {
            Text(progressTitle).font(.callout).foregroundStyle(.secondary).accessibilityIdentifier("account.progress")
        } else if !model.message.isEmpty {
            Text(L(model.message)).font(.callout).fixedSize(horizontal:false,vertical:true).padding(16).frame(maxWidth:.infinity,alignment:.leading).background(Color(.secondarySystemBackground),in:RoundedRectangle(cornerRadius:16)).accessibilityIdentifier("account.message")
        }
    }
    private var contentAvailability: some View { VStack(alignment:.leading,spacing:8) { Label("Learning",systemImage:"book.closed").font(.headline); Text("No lessons are available yet.").foregroundStyle(.secondary) }.padding(20).frame(maxWidth:.infinity,alignment:.leading).background(teal.opacity(0.07),in:RoundedRectangle(cornerRadius:20)) }
    private var introduction: String { switch mode { case .signup: return L("Accounts are for adults and guardians only. After you sign up, we’ll email you a confirmation code."); case .confirm: return L("Enter the 6-digit code we emailed you. Can’t find it? Check your spam folder."); case .recover: return L("Enter your account email. If there’s an account for it, we’ll send a code there."); case .reset: return L("Enter the code from your email and a new password."); case .login: return "" } }
    private var actionTitle: String { switch mode { case .confirm:return L("Confirm"); case .recover:return L("Send code"); case .reset:return L("Save new password"); default:return L(mode.rawValue) } }
    /// Only the next steps that make sense from here, instead of every other form.
    private var otherModes: [AccountMode] { switch mode { case .login: return [.signup,.recover,.confirm]; case .signup: return [.login,.confirm]; case .confirm: return [.login]; case .recover: return [.login,.reset]; case .reset: return [.login] } }
    private func linkTitle(_ destination:AccountMode) -> String { switch destination { case .login: return L("Back to sign in"); case .signup: return L("Create account"); case .recover: return L("Forgot password?"); case .confirm: return L("I have a confirmation code"); case .reset: return L("I have a recovery code") } }
    /// Requirements appear once every field of this form has something in it; an untouched form is not told it is wrong.
    private var shownValidationMessages: [String] {
        var touched = !email.isEmpty
        if mode == .login || mode == .signup || mode == .reset { touched = touched && !password.isEmpty }
        if mode == .signup || mode == .reset { touched = touched && !confirmPassword.isEmpty }
        if mode == .confirm || mode == .reset { touched = touched && !code.isEmpty }
        return touched ? validationMessages : []
    }
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
            case .signup: try await store.signUp(email:submittedEmail,password:submittedPassword,adult:submittedAdult); return "Almost there. Check your email for the confirmation code."
            case .confirm: try await store.confirm(email:submittedEmail,code:submittedCode,adult:submittedAdult); return "Email confirmed. You’re signed in."
            case .recover: try await store.recover(email:submittedEmail); return "If there’s an account for that email, a code is on its way."
            case .reset: try await store.reset(email:submittedEmail,code:submittedCode,password:submittedPassword); return "Password updated. Sign in with your new password."
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
    @State private var confirmErasure = false
    @State private var erasingScope:OwnerScope?
    let session:OwnerSession
    private let teal = Color(red:0.08,green:0.39,blue:0.36)
    private var selectedLessons:[ApprovedLesson] { model.library.lessons.filter { model.profiles.first(where:{$0.id == model.selected})?.lang == $0.language } }
    init(session:OwnerSession) { self.session = session; let model:LearningPresentationModel
        do {
            let root = try FileManager.default.url(for:.applicationSupportDirectory,in:.userDomainMask,appropriateFor:nil,create:true).appendingPathComponent("AyaIlmu",isDirectory:true)
            model = LearningPresentationModel(learning:LearningStore(session:session,journal:try SQLiteJournal(url:root.appendingPathComponent("learning.sqlite"))),core:AppSharedCore.make())
        } catch { model = LearningPresentationModel(storageFailure:true) }
        _model = StateObject(wrappedValue:model) }
    var body: some View {
        VStack(alignment:.leading,spacing:18) {
            if !session.networkVerified && !session.isDeviceOnly { Label("You’re offline. Lessons still work.",systemImage:"wifi.slash").foregroundStyle(.secondary) }
            if model.core.isAvailable, let learning = model.learning, !selectedLessons.isEmpty {
                Text("Lessons").font(.title2.bold())
                ForEach(selectedLessons) { course in
                    NavigationLink { LessonView(lesson:course,learning:learning,core:model.core,onProgressChanged:{ model.refresh() }) } label: {
                        HStack(spacing:12) { Image(systemName:"book.fill"); Text(course.title).fontWeight(.semibold).multilineTextAlignment(.leading); Spacer(); Image(systemName:"chevron.right").font(.footnote) }
                            .padding(16).frame(maxWidth:.infinity).foregroundStyle(.white).background(teal,in:RoundedRectangle(cornerRadius:16))
                    }
                }
            }
            if let summary = model.summary {
                Text("Progress").font(.title2.bold())
                VStack(spacing:10) {
                    LabeledContent("Answers so far",value:String(summary.localAnswers))
                    if summary.remoteAnswers > 0 { LabeledContent("Answers from your account",value:String(summary.remoteAnswers)) }
                    if let progress = model.projection {
                        LabeledContent("Skills learned",value:String(progress.learned))
                        LabeledContent("Still practising",value:String(progress.practicing))
                        LabeledContent("Worth another look",value:String(progress.blocked))
                    }
                }.padding(16).background(Color(.secondarySystemBackground),in:RoundedRectangle(cornerRadius:16))
            }
            Text("Profiles").font(.title2.bold())
            if model.profiles.isEmpty { Text(session.isDeviceOnly ? "Short maths practice for adults. Choose a lesson language to start; your progress stays on this device.":"Create a profile to start learning.").foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true) }
            ForEach(model.profiles,id:\.id) { profile in
                Button { model.select(profile.id) } label: {
                    HStack { Image(systemName:model.selected == profile.id ? "checkmark.circle.fill":"circle"); Text(profile.lang == "id" ? "Bahasa Indonesia":"English"); Spacer() }
                }.disabled(model.busy)
            }
            VStack(alignment:.leading,spacing:12) {
                Text("New profile").font(.headline)
                Picker("Lesson language",selection:$language) { Text("Bahasa Indonesia").tag("id"); Text("English").tag("en") }.pickerStyle(.segmented)
                HStack {
                    Button(model.profiles.isEmpty && session.isDeviceOnly ? "Start" : "Create profile") { Task { await model.run { try await $0.createAdult(language:language) } } }.buttonStyle(.borderedProminent).tint(teal).disabled(model.busy || !(session.networkVerified || session.isDeviceOnly))
                    Spacer()
                    if !session.isDeviceOnly { Button("Refresh") { Task { await model.run { try await $0.loadProfiles() } } }.disabled(model.busy || !session.networkVerified) }
                }
            }.padding(16).background(Color(.secondarySystemBackground),in:RoundedRectangle(cornerRadius:16))
            if let summary = model.summary, !session.isDeviceOnly {
                Text("Sync").font(.title2.bold())
                Text(summary.enabled ? "Sync is on for this profile.":"Sync is off.").font(.subheadline)
                if summary.enabled || summary.pending > 0 { LabeledContent("Answers waiting to sync",value:String(summary.pending)).font(.subheadline) }
                if summary.withdrawalPending { Text("Sync is off on this device. We’ll finish turning it off on your account when you’re back online.").font(.subheadline) }
                Text("Only answers from after you turn sync on are uploaded. Other profiles on this device aren’t linked.").font(.footnote).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true)
                if summary.serverCopyErased {
                    Text("This profile’s server data has been deleted. Learning on this device and your account stay.").font(.subheadline)
                } else {
                    if summary.erasurePending {
                        Text("The deletion isn’t confirmed yet. Sync has stopped. Sign in again if asked, then retry.").font(.subheadline)
                    } else {
                        if summary.enabled || summary.withdrawalPending {
                            Button("Sync now") { Task { await model.run { try await $0.sync() } } }.buttonStyle(.bordered).disabled(model.busy || !session.networkVerified)
                            Button("Turn off sync") { Task { await model.disable() } }
                        } else {
                            Button("Turn on sync") { Task { await model.run { try await $0.enableSync(proofs:selectedLessons.map(\.proof)) } } }
                                .buttonStyle(.bordered).disabled(model.busy || !session.networkVerified || selectedLessons.isEmpty)
                        }
                    }
                    Button(summary.erasurePending ? "Retry deletion":"Delete server copy",role:.destructive) {
                        erasingScope = model.learning?.scope; confirmErasure = erasingScope != nil
                    }.font(.subheadline).disabled(model.busy || !session.networkVerified)
                    .confirmationDialog("Delete this profile’s data from the server?",isPresented:$confirmErasure,titleVisibility:.visible) {
                        if let expected = erasingScope {
                            Button("Delete permanently",role:.destructive) {
                                Task { await model.run { _ = try await $0.eraseServerCopy(expected:expected,confirmed:true) } }
                            }
                        }
                        Button("Cancel",role:.cancel) { erasingScope = nil }
                    } message: {
                        Text("This profile, its synced answers and its sync consent are permanently removed from the server. Learning on this device and your account stay. We keep a small record that the deletion happened, so old data can’t be uploaded again. After this, the profile can’t sync again.")
                    }
                }
            }
            if model.busy { ProgressView() }
            if !model.message.isEmpty { Text(L(model.message)).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true).accessibilityIdentifier("learning.message") }
        }.task { if session.networkVerified { await model.run { try await $0.loadProfiles() } } }
    }
}

struct LessonView: View {
    let lesson:ApprovedLesson; let learning:LearningStore; let core:SharedLessonCore
    let onProgressChanged:() -> Void
    @State private var session:LessonSession?; @State private var number = ""; @State private var message = ""; @State private var revision = 0
    @State private var sliderValue:Double?; @State private var sequence:[String] = []; @State private var pairings:[String:String] = [:]
    @Environment(\.dismiss) private var dismiss
    private let teal = Color(red:0.08,green:0.39,blue:0.36)
    var body: some View {
        ScrollView {
            VStack(alignment:.leading,spacing:20) {
                if let session, !session.isDone, session.total > 0 {
                    ProgressView(value:Double(min(session.position,session.total)),total:Double(session.total)).tint(teal)
                        .accessibilityLabel(Text("Step \(min(session.position + 1,session.total)) of \(session.total)"))
                }
                if let screen = session?.currentScreen {
                    VStack(alignment:.leading,spacing:10) {
                        Text(screen.title).font(.title2.bold()).fixedSize(horizontal:false,vertical:true)
                        ForEach(screen.body,id:\.self) { Text($0).fixedSize(horizontal:false,vertical:true) }
                    }.padding(18).frame(maxWidth:.infinity,alignment:.leading).background(Color(.secondarySystemBackground),in:RoundedRectangle(cornerRadius:16))
                }
                if let item = session?.current { question(item).id(item.id) }
                if let feedback = session?.lastFeedback, !feedback.isEmpty {
                    VStack(alignment:.leading,spacing:8) { ForEach(feedback,id:\.self) { Text($0).fixedSize(horizontal:false,vertical:true) } }
                        .padding(16).frame(maxWidth:.infinity,alignment:.leading).background(teal.opacity(0.08),in:RoundedRectangle(cornerRadius:16))
                }
                if session?.canAdvance == true { Button { advance() } label: { Text("Continue").fontWeight(.semibold).frame(maxWidth:.infinity).padding(.vertical,7) }.buttonStyle(.borderedProminent).tint(teal).accessibilityIdentifier("lesson.continue") }
                else if session != nil && session?.current == nil {
                    VStack(spacing:12) {
                        Image(systemName:"checkmark.circle.fill").font(.system(size:56)).foregroundStyle(teal)
                        Text("That’s today’s session done").font(.title2.bold()).multilineTextAlignment(.center)
                        Text("Your answers are saved.").foregroundStyle(.secondary)
                        Button { dismiss() } label: { Text("Back to lessons").fontWeight(.semibold).frame(maxWidth:.infinity).padding(.vertical,7) }.buttonStyle(.borderedProminent).tint(teal)
                    }.frame(maxWidth:.infinity).padding(.top,24)
                }
                if !message.isEmpty { Text(L(message)).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true) }
            }.padding(24).frame(maxWidth:560).frame(maxWidth:.infinity).id(revision)
        }.navigationTitle(lesson.title).onDisappear(perform:onProgressChanged).task {
            do { session = try LessonSession(lesson:lesson,learning:learning,core:core) }
            catch { message = "This lesson can’t be opened right now. Your progress is safe." }
        }
    }
    @ViewBuilder private func question(_ item:LessonItem) -> some View {
        VStack(alignment:.leading,spacing:8) {
            Text(item.prompt).font(.title2.bold()).fixedSize(horizontal:false,vertical:true)
            ForEach(item.help,id:\.self) { Text($0).foregroundStyle(.secondary).fixedSize(horizontal:false,vertical:true) }
        }
        if ["choose","true_false"].contains(item.type) {
            VStack(spacing:10) {
                ForEach(item.options,id:\.id) { option in
                    Button { submit(["kind":"choice","option_id":option.id]) } label: {
                        Text(option.title).multilineTextAlignment(.leading).frame(maxWidth:.infinity,alignment:.leading).padding(.vertical,10).padding(.horizontal,4)
                    }.buttonStyle(.bordered).tint(teal)
                }
            }
        } else if item.type == "number_input" {
            TextField("Your answer",text:$number).keyboardType(.decimalPad).font(.title3).padding(12).background(Color(.secondarySystemBackground),in:RoundedRectangle(cornerRadius:12))
            checkButton(disabled:LocalizedNumberInput.parse(number,language:lesson.language) == nil) {
                guard let value = LocalizedNumberInput.parse(number,language:lesson.language) else { message = "Enter a number to continue."; return }; submit(["kind":"number","value":value])
            }
        } else if item.type == "estimate_slider",let range = item.slider {
            VStack(spacing:8) {
                Text((sliderValue ?? range.min).formatted(.number.locale(Locale(identifier:lesson.language == "id" ? "id_ID":"en_US")))).font(.title.bold()).monospacedDigit().frame(maxWidth:.infinity)
                Slider(value:Binding(get:{sliderValue ?? range.min},set:{sliderValue = $0}),in:range.min...range.max,step:range.step).tint(teal)
            }.padding(16).background(Color(.secondarySystemBackground),in:RoundedRectangle(cornerRadius:16))
            checkButton(disabled:sliderValue == nil) { guard let value = sliderValue else { return }; submit(["kind":"number","value":value]) }
        } else if ["tiles","fill_blank","order"].contains(item.type) {
            VStack(alignment:.leading,spacing:8) {
                HStack { Text("Your answer").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary); Spacer(); if !sequence.isEmpty { Button("Clear") { sequence = [] }.font(.subheadline) } }
                Text(sequence.isEmpty ? " " : sequence.compactMap{id in item.options.first{$0.id == id}?.title}.joined(separator:"  ")).font(.title3.weight(.semibold)).frame(maxWidth:.infinity,minHeight:28,alignment:.leading)
            }.padding(14).background(teal.opacity(0.08),in:RoundedRectangle(cornerRadius:14))
            LazyVGrid(columns:[GridItem(.adaptive(minimum:96),spacing:10)],spacing:10) {
                ForEach(item.options,id:\.id) { option in
                    let picked = sequence.contains(option.id)
                    Button { if let index = sequence.firstIndex(of:option.id) { sequence.remove(at:index) } else { sequence.append(option.id) } } label: {
                        Text(option.title).frame(maxWidth:.infinity).padding(.vertical,8)
                    }.buttonStyle(.bordered).tint(picked ? .secondary:teal).opacity(picked ? 0.55:1).accessibilityAddTraits(picked ? .isSelected:[])
                }
            }
            checkButton(disabled:sequence.isEmpty) { submit(["kind":"sequence","sequence":sequence]) }
        } else if item.type == "match_pairs" {
            VStack(spacing:0) {
                ForEach(Array(item.leftIDs.enumerated()),id:\.element) { index,left in
                    if index > 0 { Divider() }
                    let title = item.options.first{$0.id == left}?.title ?? left
                    let picker = Picker(title,selection:Binding(get:{pairings[left] ?? ""},set:{pairings[left] = $0})) {
                        Text("Choose a match").tag("")
                        ForEach(item.rightIDs,id:\.self) { right in Text(item.options.first{$0.id == right}?.title ?? right).tag(right).disabled(pairings.contains{$0.key != left && $0.value == right}) }
                    }.labelsHidden().pickerStyle(.menu).tint(teal).fixedSize()
                    ViewThatFits(in:.horizontal) {
                        HStack(spacing:12) { Text(title).font(.body.weight(.medium)).fixedSize(); Spacer(minLength:8); picker }
                        VStack(alignment:.leading,spacing:2) { Text(title).font(.body.weight(.medium)).fixedSize(horizontal:false,vertical:true); picker }.frame(maxWidth:.infinity,alignment:.leading)
                    }.padding(.vertical,10).padding(.horizontal,14)
                }
            }.background(Color(.secondarySystemBackground),in:RoundedRectangle(cornerRadius:16))
            checkButton(disabled:item.leftIDs.contains{pairings[$0] == nil || pairings[$0] == ""} || Set(pairings.values).count != item.leftIDs.count) {
                submit(["kind":"pairs","pairs":item.leftIDs.compactMap{left in pairings[left].map{["left":left,"right":$0]}}])
            }
        } else if ["info_card","mini_reading"].contains(item.type) {
            if let body = item.modelAnswer { Text(body).fixedSize(horizontal:false,vertical:true).padding(18).frame(maxWidth:.infinity,alignment:.leading).background(Color(.secondarySystemBackground),in:RoundedRectangle(cornerRadius:16)) }
            Button { submit(["kind":"choice","option_id":"seen"]) } label: { Text("Continue").fontWeight(.semibold).frame(maxWidth:.infinity).padding(.vertical,7) }.buttonStyle(.borderedProminent).tint(teal)
        }
        if !["info_card","mini_reading"].contains(item.type) {
            Button("I don’t know yet") { submit(["kind":"dont_know"]) }.font(.subheadline).foregroundStyle(teal).frame(maxWidth:.infinity).accessibilityIdentifier("lesson.dontKnow")
        }
    }
    private func checkButton(disabled:Bool,action:@escaping () -> Void) -> some View {
        Button(action:action) { Text("Check").fontWeight(.semibold).frame(maxWidth:.infinity).padding(.vertical,7) }.buttonStyle(.borderedProminent).tint(teal).disabled(disabled).accessibilityIdentifier("lesson.check")
    }
    private func resetDraft() { number = ""; sliderValue = nil; sequence = []; pairings = [:]; message = ""; revision += 1 }
    private func submit(_ response:[String:Any]) {
        do { let raw = String(data:try JSONSerialization.data(withJSONObject:response,options:.sortedKeys),encoding:.utf8)!; try session?.submit(responseJSON:raw); resetDraft() }
        catch { message = "Your answer wasn’t saved. Please try again." }
    }
    private func advance() { do { try session?.advance(); resetDraft() } catch { message = "Your progress wasn’t saved. Please try again." } }
}
