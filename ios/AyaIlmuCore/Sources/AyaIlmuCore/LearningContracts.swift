import Foundation
import CryptoKit

public enum LearningError: Error, LocalizedError {
    case signInRequired, staleSession, invalidData, immutableConflict, storage, consentOff, noContent, gradingUnavailable, busy
    case backend(Int,String)
    public var errorDescription:String? {
        switch self {
        case .signInRequired: return "Sign in to your owner account to continue."
        case .staleSession: return "The account or profile changed. Please try again."
        case .consentOff: return "Sync is off for this profile."
        case .noContent: return "No lessons are available yet."
        case .gradingUnavailable: return "Learning is not available in this build yet."
        case .storage: return "Your progress could not be saved. Please try again."
        case .immutableConflict: return "Saved answers differ from account history. Sync stopped without replacing them."
        case .busy: return "Please wait for the current action to finish."
        case .backend(_,let code):
            if code == "sync_consent_update_required" { return "The sync policy changed. Enable sync again to grant the current version; nothing uploads until then." }
            if code == "sync_consent_required" { return "Sync is off for this profile." }
            if code == "fresh_authentication_required" { return "For your security, sign in with your password again to continue this action." }
            return "The account action did not complete. Please try again."
        case .invalidData: return "Account history could not be verified. Nothing from this response was saved."
        }
    }
}
func validID(_ s:String) -> Bool { s.range(of:"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$",options:.regularExpression) != nil }
func pathID(_ s:String) -> Bool { s.range(of:"^[A-Za-z0-9_-]{1,128}$",options:.regularExpression) != nil }
public struct OwnerScope: Codable, Hashable, Sendable {
    public let origin:String; public let owner:String; public let learner:String
    public init(origin:String,owner:String,learner:String) { self.origin = origin; self.owner = owner; self.learner = learner }
}
@MainActor public final class OwnerSession: CustomStringConvertible {
    public let origin:String; public let ownerID:String; public let subjectID:String
    let api:AccountAPI; let token:String; public private(set) var networkVerified:Bool; let isCurrent:() -> Bool
    init(api:AccountAPI,saved:SavedSession,networkVerified:Bool,isCurrent:@escaping () -> Bool) { self.api = api; self.networkVerified = networkVerified; token = saved.session.accessToken; origin = saved.origin; ownerID = saved.accountID; subjectID = saved.session.user.id; self.isCurrent = isCurrent }
    public nonisolated var description:String { "OwnerSession(redacted)" }
    public func check() throws { guard isCurrent(), !Task.isCancelled else { throw LearningError.staleSession } }
    func request(_ method:String,_ path:String,body:[String:Any]? = nil) async throws -> Data {
        try check(); guard networkVerified else { throw LearningError.signInRequired }
        do { let data = try await api.request(method,path,body:body,token:token,errorField:"error",maxBodyBytes:1048576,maxResponseBytes:4194304); try check(); return data }
        catch let AccountError.http(status,code) { try check(); if status == 401 || status == 403 && ["bad_jwt","fresh_authentication_required"].contains(code) { networkVerified = false }; throw LearningError.backend(status,code) }
    }
}
public struct OwnerLearner: Codable, Equatable, Sendable {
    public let id:String; public let client_learner_id:String; public let kind:String; public let audience:String; public let lang:String; public let created_by:String?
    public func validate() throws { guard pathID(id), validID(client_learner_id), !client_learner_id.hasPrefix("syn_"), kind == "ADULT", audience == "adults", ["id","en"].contains(lang), created_by == nil || created_by == "" else { throw LearningError.invalidData } }
}
public struct PackProof: Codable, Equatable, Sendable {
    public let track:String; public let contentVersion:String; public let rulesVersion:String; public let packSHA256:String; public let rulesSHA256:String; public let sourceCommit:String
    public init(track:String,contentVersion:String,rulesVersion:String,packSHA256:String,rulesSHA256:String,sourceCommit:String) { self.track = track; self.contentVersion = contentVersion; self.rulesVersion = rulesVersion; self.packSHA256 = packSHA256; self.rulesSHA256 = rulesSHA256; self.sourceCommit = sourceCommit }
    func validate() throws { guard validID(track), validID(contentVersion), validID(rulesVersion), [packSHA256,rulesSHA256].allSatisfy({$0.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil}), sourceCommit.range(of:"^[a-f0-9]{40}$",options:.regularExpression) != nil else { throw LearningError.invalidData } }
}
struct Catalog: Decodable {
    struct Pack: Decodable { let track:String; let content_version:String; let rules_version:String; let sha256:String; let rules_sha256:String }
    let source_commit:String; let packs:[Pack]
    func verify(_ proofs:[PackProof],source:String) throws {
        guard source_commit == source, !proofs.isEmpty, packs.count <= 1000 else { throw LearningError.noContent }
        for proof in proofs { try proof.validate(); guard proof.sourceCommit == source, packs.filter({$0.track == proof.track && $0.content_version == proof.contentVersion && $0.rules_version == proof.rulesVersion && $0.sha256 == proof.packSHA256 && $0.rules_sha256 == proof.rulesSHA256}).count == 1 else { throw LearningError.noContent } }
    }
}
struct SyncReceipt: Decodable { let answer_id:String; let sequence:Int64; let duplicate:Bool; let registry_status:String }
struct RemoteAnswer: Codable { let sequence:Int64; let payload:String; let registry_status:String }
struct RemotePage: Decodable { let events:[RemoteAnswer]; let next_cursor:Int64; let has_more:Bool }
public struct ProgressSummary: Sendable { public let localAnswers:Int; public let pending:Int; public let remoteAnswers:Int; public let enabled:Bool; public let withdrawalPending:Bool }

/// Wire validator only. Scoring, freshness and mastery remain owned by the shared Kotlin core.
struct NativeAnswer: Decodable {
    let answer_id:String; let learner_id:String; let item_id:String; let track:String; let content_version:String; let rules_version:String; let app_version:String; let timestamp:String; let local_date:String; let session_id:String; let lang:String; let pool:String; let unit:String; let skills:[String]; let raw_response:String; let auto_score:[String:String]; let outcome:String; let first_attempt:Bool; let fresh_evidence:Bool; let review_status:String; let synthetic:Bool?
    let error_tags:[String]?; let serious_tag:String?; let hint_used:Bool?; let help_lines_shown:[String]?; let time_on_item_ms:Int64?; let audio_status:String?; let report_flag:Bool?; let item_type:String; let gem:Bool?
    static let scores:Set<String> = ["correct","wrong","pending","dont_know","not_assessed"]
    static let tags:Set<String> = ["wrong-referent","possession","invented-action","wrong-form","lexical","look-alike","decoding","ta-confusion","wrong-speaker","calculation","misconception","sequence"]
    static func parse(_ raw:String,learner:OwnerLearner,proof:PackProof) throws -> NativeAnswer {
        guard raw.utf8.count <= 16384 else { throw LearningError.invalidData }
        _ = try StrictJSON.object(raw,keys:["answer_id","learner_id","item_id","track","content_version","rules_version","app_version","timestamp","local_date","session_id","lang","pool","unit","skills","raw_response","auto_score","outcome","error_tags","serious_tag","hint_used","help_lines_shown","first_attempt","fresh_evidence","time_on_item_ms","audio_status","report_flag","review_status","synthetic","item_type","gem"],nullable:["serious_tag","audio_status"])
        let e = try JSONDecoder().decode(NativeAnswer.self,from:Data(raw.utf8))
        let date = ISO8601DateFormatter(); date.formatOptions = [.withInternetDateTime,.withFractionalSeconds]
        let validTimestamp = date.date(from:e.timestamp) != nil || ISO8601DateFormatter().date(from:e.timestamp) != nil
        let local = DateFormatter(); local.locale = Locale(identifier:"en_US_POSIX"); local.timeZone = TimeZone(secondsFromGMT:0); local.dateFormat = "yyyy-MM-dd"; local.isLenient = false
        guard [e.answer_id,e.learner_id,e.item_id,e.track,e.content_version,e.rules_version,e.app_version,e.session_id,e.unit].allSatisfy(validID), e.learner_id == learner.client_learner_id, !(e.synthetic ?? false), e.review_status == "approved", e.track == proof.track, e.content_version == proof.contentVersion, e.rules_version == proof.rulesVersion, e.lang == learner.lang, validTimestamp, let localDate = local.date(from:e.local_date), local.string(from:localDate) == e.local_date, ["INSTR","PRACT","READY","D7","D30","REMED","TRANS","SPARE","MT","ENTRY","REPROBE","FOCUS","GEM"].contains(e.pool), scores.contains(e.outcome), e.skills.count <= 100, e.skills.allSatisfy(validID), e.auto_score.allSatisfy({validID($0.key) && scores.contains($0.value)}), (e.error_tags ?? []).count <= 30, (e.error_tags ?? []).allSatisfy(tags.contains), e.serious_tag == nil || tags.contains(e.serious_tag!), (e.help_lines_shown ?? []).count <= 100, (e.help_lines_shown ?? []).allSatisfy({$0.utf8.count <= 512}), (e.time_on_item_ms ?? 0) >= 0, e.audio_status == nil || ["played","failed","unavailable"].contains(e.audio_status!) else { throw LearningError.invalidData }
        if e.fresh_evidence && (e.hint_used == true || !e.first_attempt || e.gem == true || ["INSTR","FOCUS","GEM"].contains(e.pool) || ["trace","story","info_card","memory_flip","daily_puzzle"].contains(e.item_type)) { throw LearningError.invalidData }
        try e.validateResponse(); return e
    }
    private func validateResponse() throws {
        struct Pair:Decodable { let left:String; let right:String }
        struct Response:Decodable { let kind:String; let text:String?; let ref:String?; let option_id:String?; let value:Double?; let sequence:[String]?; let pairs:[Pair]?; let audio_status:String? }
        _ = try StrictJSON.object(raw_response,keys:["kind","text","ref","option_id","value","sequence","pairs","audio_status"],nullable:["text","ref","option_id","value","sequence","pairs","audio_status"])
        if let object = try JSONSerialization.jsonObject(with:Data(raw_response.utf8)) as? [String:Any], let pairs = object["pairs"] as? [[String:Any]] {
            for pair in pairs { guard Set(pair.keys) == Set(["left","right"]),pair["left"] is String,pair["right"] is String else { throw LearningError.invalidData } }
        }
        let r = try JSONDecoder().decode(Response.self,from:Data(raw_response.utf8))
        let fields = [r.text != nil,r.option_id != nil,r.value != nil,r.sequence != nil,r.pairs != nil].filter{$0}.count
        let allowed:[String:Set<String>] = ["choose":["choice"],"pick_image":["choice"],"true_false":["choice"],"audio_match":["choice"],"story_choice":["choice"],"tap_hotspot":["choice"],"type_in":["typed"],"number_input":["number"],"estimate_slider":["number"],"fill_blank":["sequence"],"tiles":["sequence"],"order":["sequence"],"match_pairs":["pairs"],"sort_buckets":["pairs"],"memory_flip":["pairs"],"daily_puzzle":["choice","number"],"trace":["sequence"],"story":["choice"],"info_card":["choice"],"mini_reading":["choice"]]
        guard let kinds = allowed[item_type], r.audio_status == nil || ["played","failed","unavailable"].contains(r.audio_status!) else { throw LearningError.invalidData }
        if r.kind == "dont_know" { guard fields == 0, r.ref == nil else { throw LearningError.invalidData } }
        else {
            guard fields == 1, kinds.contains(r.kind), r.ref == nil || r.kind == "typed" else { throw LearningError.invalidData }
            switch r.kind {
            case "choice": guard validID(r.option_id ?? "") else { throw LearningError.invalidData }
            case "number": guard r.value?.isFinite == true else { throw LearningError.invalidData }
            case "typed": guard let text = r.text, text.utf8.count <= 2048, !text.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty, r.ref == nil || ["laki-laki","perempuan","dont_know"].contains(r.ref!) else { throw LearningError.invalidData }
            case "sequence": guard let values = r.sequence, !values.isEmpty, values.count <= 100, values.allSatisfy(validID) else { throw LearningError.invalidData }
            case "pairs": guard let pairs = r.pairs, !pairs.isEmpty, pairs.count <= 100, Set(pairs.map(\.left)).count == pairs.count, pairs.allSatisfy({validID($0.left) && validID($0.right)}) else { throw LearningError.invalidData }
            default: throw LearningError.invalidData
            }
        }
        if ["story","info_card","mini_reading"].contains(item_type) { guard r.option_id == "seen", outcome == "not_assessed" else { throw LearningError.invalidData } }
    }
}

public struct SharedProjectionSummary: Sendable {
    public let learned:Int; public let practicing:Int; public let blocked:Int; public let waitingForFreshContent:Int
    static func read(_ raw:String) throws -> SharedProjectionSummary {
        struct Skill:Decodable { let status:String }
        struct Projection:Decodable { let skills:[String:Skill] }
        let value = try JSONDecoder().decode(Projection.self,from:Data(raw.utf8))
        let known:Set<String> = ["NOT_STARTED","PRACTICING","LEARNED","BLOCKED","OUT_OF_FRESH"]
        guard value.skills.count <= 10000,value.skills.values.allSatisfy({known.contains($0.status)}) else { throw LearningError.invalidData }
        func count(_ status:String) -> Int { value.skills.values.filter{$0.status == status}.count }
        return SharedProjectionSummary(learned:count("LEARNED"),practicing:count("PRACTICING"),blocked:count("BLOCKED"),waitingForFreshContent:count("OUT_OF_FRESH"))
    }
}
