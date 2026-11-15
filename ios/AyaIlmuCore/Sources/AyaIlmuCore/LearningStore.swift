import Foundation
@MainActor public final class LearningStore {
    private let session:OwnerSession
    private let journal:SQLiteJournal
    private let policy:String
    private let source:String
    private var generation = 0
    private var busy = false
    private var consentTask:Task<Void,Error>?
    private var knownProfiles:[OwnerLearner] = []
    public var profiles:[OwnerLearner] { (try? session.check()) != nil ? knownProfiles:[] }
    private var selectedScope:OwnerScope?
    public var scope:OwnerScope? { (try? session.check()) != nil ? selectedScope:nil }
    public init(session:OwnerSession,journal:SQLiteJournal) {
        self.session = session; self.journal = journal
        policy = session.syncPolicyVersion; source = session.registrySourceCommit
    }
    private func networkCheck() throws {
        guard try !journal.accountFrozen(origin:session.origin,owner:session.ownerID) else { throw LearningError.consentOff }
    }
    private func request(_ method:String,_ path:String,body:[String:Any]? = nil) async throws -> Data {
        try networkCheck()
        let data = try await session.request(method,path,body:body)
        try networkCheck(); return data
    }
    private func check(_ mark:Int? = nil) throws { try session.check(); if let mark,mark != generation { throw LearningError.staleSession }; guard session.isDeviceOnly || !policy.isEmpty,!source.isEmpty else { throw AccountError.configuration } }
    public func detach() { generation += 1; selectedScope = nil; knownProfiles = []; consentTask?.cancel() }
    public func restoreOfflineProfiles() throws {
        try check(); let saved = try journal.account(origin:session.origin,owner:session.ownerID)
        try saved.profiles.forEach { try $0.validate() }; knownProfiles = saved.profiles
        if let selected = saved.selected, profiles.contains(where:{$0.id == selected}) { try select(selected) }
    }
    public func loadProfiles() async throws {
        if session.isDeviceOnly { try restoreOfflineProfiles(); return }
        try check(); let mark = generation
        try await flushOwnerWithdrawals(mark:mark)
        let data = try await request("GET","/v1/learners"); try check(mark)
        let all = try JSONDecoder().decode([OwnerLearner].self,from:data)
        guard all.count <= 1000, Set(all.map(\.id)).count == all.count, Set(all.map(\.client_learner_id)).count == all.count else { throw LearningError.invalidData }
        // This native slice handles only adult self profiles; no child account flow is exposed.
        var adults = all.filter{$0.kind == "ADULT"}; try adults.forEach{try $0.validate()}
        // Keep locally retained history and uncertain erasure requests reachable when the server list no longer includes them.
        for retained in try journal.erasureProfiles(origin:session.origin,owner:session.ownerID) {
            if let remote = adults.first(where:{$0.id == retained.id}) { guard remote == retained else { throw LearningError.invalidData } }
            else { adults.append(retained) }
        }
        try journal.updateAccount(origin:session.origin,owner:session.ownerID) { state in state.profiles = adults; if !adults.contains(where:{$0.id == state.selected}) { state.selected = nil } }
        knownProfiles = adults
        if let active = scope, !adults.contains(where:{$0.id == active.learner}) { generation += 1; selectedScope = nil }
    }
    public func createAdult(language:String) async throws {
        try check(); guard ["id","en"].contains(language), !busy else { throw LearningError.busy }
        if session.isDeviceOnly { try createDeviceAdult(language:language); return }
        busy = true; defer { busy = false }; let mark = generation
        var state = try journal.account(origin:session.origin,owner:session.ownerID)
        if state.pendingProfile == nil { try journal.updateAccount(origin:session.origin,owner:session.ownerID) { $0.pendingProfile = PendingProfile(clientID:UUID().uuidString.lowercased(),language:language) }; state = try journal.account(origin:session.origin,owner:session.ownerID) }
        guard let pending = state.pendingProfile, pending.language == language else { throw LearningError.invalidData }
        let data = try await request("POST","/v1/learners",body:["client_learner_id":pending.clientID,"kind":"ADULT","lang":language,"synthetic":false]); try check(mark)
        let learner = try JSONDecoder().decode(OwnerLearner.self,from:data); try learner.validate()
        guard learner.client_learner_id == pending.clientID, learner.lang == language else { throw LearningError.invalidData }
        try journal.updateAccount(origin:session.origin,owner:session.ownerID) { current in
            guard current.pendingProfile?.clientID == pending.clientID, !current.profiles.contains(where:{$0.id == learner.id && $0 != learner}) else { throw LearningError.invalidData }
            current.profiles.removeAll{$0.id == learner.id}; current.profiles.append(learner); current.pendingProfile = nil
        }
        knownProfiles = try journal.account(origin:session.origin,owner:session.ownerID).profiles; try select(learner.id)
    }
    /// Creates an adult self profile that exists only on this device; nothing is sent.
    private func createDeviceAdult(language:String) throws {
        let id = UUID().uuidString.lowercased()
        let learner = OwnerLearner(id:id,client_learner_id:id,kind:"ADULT",audience:"adults",lang:language,created_by:nil)
        try learner.validate()
        try journal.updateAccount(origin:session.origin,owner:session.ownerID) { current in
            guard current.profiles.count < 1000 else { throw LearningError.invalidData }
            current.profiles.append(learner)
        }
        knownProfiles = try journal.account(origin:session.origin,owner:session.ownerID).profiles; try select(learner.id)
    }
    public func select(_ id:String) throws {
        try check(); guard let learner = profiles.first(where:{$0.id == id}) else { throw LearningError.invalidData }; try learner.validate()
        let next = OwnerScope(origin:session.origin,owner:session.ownerID,learner:id)
        try journal.insert(next,learner:learner)
        try journal.updateAccount(origin:session.origin,owner:session.ownerID) { $0.selected = id }
        generation += 1; selectedScope = next
    }
    private func active() throws -> (OwnerScope,LearningPartition) { try check(); guard let scope else { throw LearningError.invalidData }; return(scope,try journal.read(scope)) }
    public func requireScope(_ expected:OwnerScope) throws { try check(); guard scope == expected else { throw LearningError.staleSession } }
    func selectedLearner() throws -> OwnerLearner { try active().1.learner }
    func history() throws -> [String] {
        let state = try active().1
        var answers = state.answers.mapValues(\.payload)
        for record in state.remote { guard let object = try JSONSerialization.jsonObject(with:Data(record.payload.utf8)) as? [String:Any],let id = object["answer_id"] as? String else { throw LearningError.storage }; if let existing = answers[id],existing != record.payload { throw LearningError.immutableConflict }; answers[id] = record.payload }
        guard let order = state.eventOrder,Set(order).count == order.count,Set(order) == Set(answers.keys) else { if answers.isEmpty { return [] }; throw LearningError.storage }
        return order.compactMap{answers[$0]}
    }
    public func projection(lesson:ApprovedLesson,core:SharedLessonCore) throws -> SharedProjectionSummary {
        let(_,state) = try active()
        guard core.isAvailable,lesson.proof.sourceCommit == source,lesson.language == state.learner.lang else { throw LearningError.noContent }
        if let known = state.proofs[lesson.proof.track],known != lesson.proof { throw LearningError.noContent }
        let context = String(data:try JSONSerialization.data(withJSONObject:["learner_id":state.learner.client_learner_id]),encoding:.utf8)!
        return try SharedProjectionSummary.read(core.project(packJSON:lesson.packJSON,rulesJSON:lesson.rulesJSON,historyJSON:historyJSON(),contextJSON:context))
    }
    public func summary() throws -> ProgressSummary {
        let(_,state) = try active()
        return ProgressSummary(localAnswers:state.answers.count,pending:state.deletionRequestID == nil ? state.answers.values.filter{$0.eligible && $0.acknowledgedSequence == nil}.count:0,remoteAnswers:state.remote.count,enabled:state.enabled && state.policyVersion == policy,withdrawalPending:state.withdrawalPending,erasurePending:state.deletionRequestID != nil && state.deletionReceipt == nil,serverCopyErased:state.deletionReceipt != nil)
    }
    /// Receives an already graded exact Kotlin event. This method does no grading/mastery inference.
    public func capture(_ payload:String,proof:PackProof) throws {
        let(scope,state) = try active(); try proof.validate(); guard proof.sourceCommit == source else { throw LearningError.noContent }
        let event = try NativeAnswer.parse(payload,learner:state.learner,proof:proof)
        try journal.update(scope) { try capture(payload,event:event,proof:proof,current:&$0) }
    }
    private func capture(_ payload:String,event:NativeAnswer,proof:PackProof,current:inout LearningPartition) throws {
        if let old = current.answers[event.answer_id] { guard old.payload == payload else { throw LearningError.immutableConflict }; return }
        if let remote = current.remote.first(where:{ ((try? JSONSerialization.jsonObject(with:Data($0.payload.utf8))) as? [String:Any])?["answer_id"] as? String == event.answer_id }) { guard remote.payload == payload else { throw LearningError.immutableConflict } }
        if let known = current.proofs[proof.track],known != proof { throw LearningError.noContent }
        current.proofs[proof.track] = proof
        if current.eventOrder == nil { guard current.answers.isEmpty && current.remote.isEmpty else { throw LearningError.storage }; current.eventOrder = [] }; if !current.eventOrder!.contains(event.answer_id) { current.eventOrder!.append(event.answer_id) }
        current.answers[event.answer_id] = StoredAnswer(payload:payload,eligible:current.enabled && current.policyVersion == policy && !current.withdrawalPending,acknowledgedSequence:nil)
    }
    func seenScreens(proof:PackProof) throws -> [String] { try active().1.seenScreens?[proof.track+"|"+proof.contentVersion] ?? [] }
    private func updateSeenScreens(_ saved:SavedLearningSession,current:inout LearningPartition) throws {
        guard let state = try JSONSerialization.jsonObject(with:Data(saved.snapshot.stateJSON.utf8)) as? [String:Any] else { throw LearningError.invalidData }
        let ids = state["seenScreens"] as? [String] ?? []
        guard ids.count <= 10000,ids.allSatisfy(validID) else { throw LearningError.invalidData }
        let key = saved.proof.track+"|"+saved.proof.contentVersion
        var seen = current.seenScreens ?? [:]; var merged = seen[key] ?? []
        for id in ids where !merged.contains(id) { merged.append(id) }; seen[key] = merged; current.seenScreens = seen
    }
    func savedLesson() throws -> SavedLearningSession? { try active().1.savedSession }
    func historyJSON() throws -> String { String(data:try JSONSerialization.data(withJSONObject:history(),options:.sortedKeys),encoding:.utf8)! }
    func saveInitialLesson(_ saved:SavedLearningSession) throws {
        let(scope,_) = try active(); guard saved.proof.sourceCommit == source else { throw LearningError.noContent }
        try journal.update(scope) { $0.savedSession = saved }
    }
    func commitLessonTransition(previous:SavedLearningSession,next:SavedLearningSession) throws {
        let(scope,_) = try active()
        try journal.update(scope) { state in if state.savedSession == next { return }; guard state.savedSession == previous else { throw LearningError.staleSession }; state.savedSession = next; try updateSeenScreens(next,current:&state) }
    }
    func commitLessonAnswer(_ payload:String,proof:PackProof,previous:SavedLearningSession,next:SavedLearningSession) throws {
        let(scope,state) = try active(); guard proof.sourceCommit == source else { throw LearningError.noContent }
        let event = try NativeAnswer.parse(payload,learner:state.learner,proof:proof)
        try journal.update(scope) { current in
            // Idempotently recognize a commit whose acknowledgement was lost before the UI advanced.
            if current.savedSession == next,current.answers[event.answer_id]?.payload == payload { return }
            guard current.savedSession == previous else { throw LearningError.staleSession }
            try capture(payload,event:event,proof:proof,current:&current); current.savedSession = next; try updateSeenScreens(next,current:&current)
        }
    }
    private func catalog(_ proofs:[PackProof]) async throws { let data = try await request("GET","/v1/packs"); try JSONDecoder().decode(Catalog.self,from:data).verify(proofs,source:source) }
    public func enableSync(proofs:[PackProof]) async throws {
        let(scope,state) = try active(); guard !busy,consentTask == nil else { throw LearningError.busy }; guard state.deletionRequestID == nil else { throw LearningError.consentOff }
        let mark = generation
        let task = Task { @MainActor in
            try await self.flushOwnerWithdrawals(mark:mark)
            try await self.catalog(proofs); try self.check(mark)
            guard self.scope == scope else { throw LearningError.staleSession }
            _ = try await self.request("POST","/v1/learners/\(scope.learner)/consent",body:["version":self.policy,"granted":true,"synthetic":false]); try self.check(mark)
            try self.journal.update(scope) { current in
                for proof in proofs { if let old = current.proofs[proof.track],old != proof { throw LearningError.noContent }; current.proofs[proof.track] = proof }
                current.enabled = true; current.policyVersion = self.policy; current.withdrawalPending = false
            }
        }
        consentTask = task; defer { consentTask = nil }; try await task.value
    }
    private func sendWithdrawal(scope:OwnerScope,mark:Int) async throws {
        _ = try await request("POST","/v1/learners/\(scope.learner)/consent",body:["version":policy,"granted":false,"synthetic":false]); try check(mark)
        try journal.update(scope) { $0.withdrawalPending = false; $0.enabled = false }
    }
    private func flushOwnerWithdrawals(mark:Int) async throws {
        for pending in try journal.pendingWithdrawals(origin:session.origin,owner:session.ownerID) { try check(mark); try await sendWithdrawal(scope:pending,mark:mark) }
    }
    public func disableSync(localChanged:() -> Void = {}) async throws {
        let(scope,state) = try active()
        if state.deletionRequestID != nil { localChanged(); return }
        try journal.update(scope) { $0.enabled = false; $0.withdrawalPending = true }
        generation += 1; let mark = generation; localChanged()
        if let pending = consentTask { _ = try? await pending.value }
        try check(mark); try await sendWithdrawal(scope:scope,mark:mark)
    }
    /// Deletes only the server learner copy after explicit confirmation; device history and sign-in account remain.
    public func eraseServerCopy(expected:OwnerScope,confirmed:Bool) async throws -> LearnerDeletionReceipt {
        let(scope,state) = try active()
        guard confirmed,scope == expected,canonicalUUID(scope.learner) else { throw LearningError.invalidData }
        if let receipt = state.deletionReceipt { return receipt }
        guard !busy,consentTask == nil else { throw LearningError.busy }
        let request = state.deletionRequestID ?? UUID().uuidString.lowercased()
        try journal.update(scope) { $0.enabled = false; $0.withdrawalPending = false; $0.deletionRequestID = request }
        generation += 1; let mark = generation
        busy = true; defer { busy = false }
        let data = try await self.request("POST","/v1/learners/\(scope.learner)/deletion",body:["request_id":request,"confirmed":true,"synthetic":false]); try check(mark)
        let receipt = try LearnerDeletionReceipt.parse(data,learner:scope.learner,request:request)
        try journal.update(scope) { current in
            guard current.deletionRequestID == request else { throw LearningError.staleSession }
            current.deletionReceipt = receipt
        }
        return receipt
    }
    public func sync() async throws {
        let(scope,initial) = try active(); guard !busy,consentTask == nil else { throw LearningError.busy }
        busy = true; defer { busy = false }; let mark = generation
        try await flushOwnerWithdrawals(mark:mark)
        if initial.withdrawalPending { throw LearningError.consentOff }
        guard initial.enabled,initial.policyVersion == policy else { throw LearningError.consentOff }
        do {
            try await catalog(Array(initial.proofs.values)); try check(mark)
            let pending = initial.answers.filter{$0.value.eligible && $0.value.acknowledgedSequence == nil}.sorted{$0.key < $1.key}
            for start in stride(from:0,to:pending.count,by:50) {
                try check(mark); let batch = Array(pending[start..<min(start+50,pending.count)])
                let data = try await request("POST","/v1/learners/\(scope.learner)/events",body:["schema_version":1,"synthetic":false,"events":batch.map{$0.value.payload}]); try check(mark)
                let receipts = try JSONDecoder().decode([SyncReceipt].self,from:data)
                guard receipts.count == batch.count, Set(receipts.map(\.answer_id)) == Set(batch.map(\.key)), Set(receipts.map(\.sequence)).count == receipts.count, receipts.allSatisfy({$0.sequence > 0 && $0.registry_status == "registered"}) else { throw LearningError.invalidData }
                try journal.update(scope) { current in
                    for receipt in receipts {
                        guard let original = batch.first(where:{$0.key == receipt.answer_id}), current.answers[receipt.answer_id]?.payload == original.value.payload else { throw LearningError.immutableConflict }
                        guard !current.answers.contains(where:{$0.key != receipt.answer_id && $0.value.acknowledgedSequence == receipt.sequence}), !current.remote.contains(where:{$0.sequence == receipt.sequence && $0.payload != original.value.payload}) else { throw LearningError.invalidData }
                        current.answers[receipt.answer_id]?.acknowledgedSequence = receipt.sequence
                    }
                }
            }
            for _ in 0..<100 {
                try check(mark); let current = try journal.read(scope)
                let data = try await request("GET","/v1/learners/\(scope.learner)/events?after=\(current.cursor)&limit=100"); try check(mark)
                let page = try JSONDecoder().decode(RemotePage.self,from:data)
                try validate(page,current:current)
                try journal.update(scope) { latest in guard latest.cursor == current.cursor else { throw LearningError.staleSession }; if latest.eventOrder == nil { guard latest.answers.isEmpty && latest.remote.isEmpty else { throw LearningError.storage }; latest.eventOrder = [] }
                    for record in page.events { let id = (try JSONSerialization.jsonObject(with:Data(record.payload.utf8)) as! [String:Any])["answer_id"] as! String; if !latest.eventOrder!.contains(id) { latest.eventOrder!.append(id) } }
                    latest.remote.append(contentsOf:page.events); latest.cursor = page.next_cursor }
                if !page.has_more { return }
            }
            throw LearningError.invalidData
        } catch {
            if case LearningError.backend(_,let code) = error, ["sync_consent_required","sync_consent_update_required"].contains(code), (try? check(mark)) != nil { try journal.update(scope) { $0.enabled = false } }
            throw error
        }
    }
    private func validate(_ page:RemotePage,current:LearningPartition) throws {
        guard page.events.count <= 100, !page.has_more || !page.events.isEmpty else { throw LearningError.invalidData }
        var sequence = current.cursor
        var ids = Set<String>()
        for old in current.remote { guard let object = try JSONSerialization.jsonObject(with:Data(old.payload.utf8)) as? [String:Any], let id = object["answer_id"] as? String else { throw LearningError.storage }; ids.insert(id) }
        for record in page.events {
            guard sequence < Int64.max, record.sequence == sequence+1, record.registry_status == "registered", let object = try JSONSerialization.jsonObject(with:Data(record.payload.utf8)) as? [String:Any], let track = object["track"] as? String, let proof = current.proofs[track] else { throw LearningError.invalidData }
            let event = try NativeAnswer.parse(record.payload,learner:current.learner,proof:proof)
            guard ids.insert(event.answer_id).inserted else { throw LearningError.invalidData }
            if let local = current.answers[event.answer_id] { guard local.payload == record.payload, local.acknowledgedSequence == nil || local.acknowledgedSequence == record.sequence else { throw LearningError.immutableConflict } }
            guard !current.answers.contains(where:{$0.key != event.answer_id && $0.value.acknowledgedSequence == record.sequence}) else { throw LearningError.invalidData }
            sequence = record.sequence
        }
        guard page.next_cursor == sequence else { throw LearningError.invalidData }
    }
}
