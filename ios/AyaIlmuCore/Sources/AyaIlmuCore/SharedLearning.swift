import Foundation
import CryptoKit
/// Implemented only by a genuinely shared Kotlin/Native framework. No Swift scoring substitute.
public protocol SharedGrader { var isAvailable:Bool { get }; func grade(itemJSON:String,responseJSON:String,rulesJSON:String,language:String) throws -> String }
public struct SharedSessionSnapshot: Codable, Equatable, Sendable {
    public let stateJSON:String; public let currentItemID:String?; public let screenID:String?; public let phase:String; public let step:Int; public let feedbackIDs:[String]; public let feedbackMessages:[String]; public let completed:Bool
    public init(stateJSON:String,currentItemID:String?,step:Int,feedbackIDs:[String],completed:Bool,phase:String? = nil,screenID:String? = nil,feedbackMessages:[String] = []) { self.phase = phase ?? (completed ? "done":"step"); self.screenID = screenID; self.feedbackMessages = feedbackMessages; self.stateJSON = stateJSON; self.currentItemID = currentItemID; self.step = step; self.feedbackIDs = feedbackIDs; self.completed = completed }
}
public struct SharedSubmission {
    public let eventPayload:String; public let next:SharedSessionSnapshot
    public init(eventPayload:String,next:SharedSessionSnapshot) { self.eventPayload = eventPayload; self.next = next }
}
public protocol SharedLessonCore {
    func project(packJSON:String,rulesJSON:String,historyJSON:String,contextJSON:String) throws -> String
    var isAvailable:Bool { get }; var versionID:String { get }
    func advance(packJSON:String,rulesJSON:String,stateJSON:String,contextJSON:String) throws -> SharedSessionSnapshot
    func start(packJSON:String,rulesJSON:String,contextJSON:String,historyJSON:String) throws -> SharedSessionSnapshot
    func submit(packJSON:String,rulesJSON:String,stateJSON:String,responseJSON:String,contextJSON:String,historyJSON:String) throws -> SharedSubmission
}
public extension SharedLessonCore { func project(packJSON:String,rulesJSON:String,historyJSON:String,contextJSON:String) throws -> String { throw LearningError.gradingUnavailable } }
public struct UnavailableSharedGrader:SharedGrader,SharedLessonCore {
    public init() {}
    public var isAvailable:Bool { false }; public var versionID:String { "unavailable" }
    public func grade(itemJSON:String,responseJSON:String,rulesJSON:String,language:String) throws -> String { throw LearningError.gradingUnavailable }
    public func advance(packJSON:String,rulesJSON:String,stateJSON:String,contextJSON:String) throws -> SharedSessionSnapshot { throw LearningError.gradingUnavailable }
    public func start(packJSON:String,rulesJSON:String,contextJSON:String,historyJSON:String) throws -> SharedSessionSnapshot { throw LearningError.gradingUnavailable }
    public func submit(packJSON:String,rulesJSON:String,stateJSON:String,responseJSON:String,contextJSON:String,historyJSON:String) throws -> SharedSubmission { throw LearningError.gradingUnavailable }
}
struct SavedLearningSession: Codable, Equatable {
    let lessonID:String; let proof:PackProof; let language:String; let coreVersion:String; let sessionID:String; let snapshot:SharedSessionSnapshot
}
public struct LessonOption: Sendable { public let id:String; public let title:String }
public struct LessonSlider:Sendable { public let min:Double; public let max:Double; public let step:Double }
public struct LessonScreen:Identifiable,Sendable { public let id:String; public let title:String; public let body:[String] }
public struct LessonItem: Identifiable, Sendable {
    public let id:String; public let type:String; public let prompt:String; public let help:[String]; public let modelAnswer:String?; public let options:[LessonOption]; public let slider:LessonSlider?; public let leftIDs:[String]; public let rightIDs:[String]
}
public struct ApprovedLesson: Identifiable, Sendable {
    public let id:String; public let title:String; public let proof:PackProof; public let language:String
    public let introduction:[String]; public let screens:[LessonScreen]; public let items:[LessonItem]
    let packJSON:String; let rulesJSON:String; let feedback:[String:String]
}
public struct ApprovedLessonLibrary: Sendable {
    public let lessons:[ApprovedLesson]
    public static var bundled:ApprovedLessonLibrary {
        // Resources remain bound to the exact reviewed catalog bytes and source snapshot.
        // A malformed/missing resource fails closed for the entire bundled library.
        guard let manifestURL = Bundle.main.url(forResource:"ApprovedLearning",withExtension:"json"),
              let data = try? Data(contentsOf:manifestURL),
              let source = Bundle.main.object(forInfoDictionaryKey:"AyaIlmuRegistrySourceCommit") as? String else { return ApprovedLessonLibrary(lessons:[]) }
        return (try? loadResources(manifest:data,source:source) { name in
            guard let url = Bundle.main.url(forResource:name,withExtension:"json") else { throw LearningError.noContent }
            return try Data(contentsOf:url)
        }) ?? ApprovedLessonLibrary(lessons:[])
    }
    private struct ResourceManifest:Decodable { struct Entry:Decodable { let pack:String; let rules:String }; let catalog:String; let languages:[String]; let packs:[Entry] }
    static func loadResources(manifest data:Data,source:String,resource:(String) throws -> Data) throws -> ApprovedLessonLibrary {
        guard data.count <= 65536 else { throw LearningError.noContent }
        let manifest = try JSONDecoder().decode(ResourceManifest.self,from:data)
        let names = [manifest.catalog] + manifest.packs.flatMap{[$0.pack,$0.rules]}
        guard !manifest.packs.isEmpty,manifest.packs.count <= 100,
              !manifest.languages.isEmpty,manifest.languages.count <= 2,
              Set(manifest.languages).count == manifest.languages.count,
              manifest.languages.allSatisfy({["id","en"].contains($0)}),
              names.allSatisfy({$0.range(of:"^[A-Za-z0-9_-]{1,128}$",options:.regularExpression) != nil}) else { throw LearningError.noContent }
        let catalog = try resource(manifest.catalog)
        var lessons:[ApprovedLesson] = []
        for entry in manifest.packs {
            let pack = try resource(entry.pack), rules = try resource(entry.rules)
            for language in manifest.languages {
                lessons += try load(pack:pack,rules:rules,catalog:catalog,source:source,language:language).lessons
            }
        }
        let identities = lessons.map{$0.language+"|"+$0.id}
        guard Set(identities).count == identities.count else { throw LearningError.noContent }
        return ApprovedLessonLibrary(lessons:lessons)
    }
    public static func proof(pack:Data,rules:Data,source:String) -> PackProof {
        let p = (try? JSONSerialization.jsonObject(with:pack)) as? [String:Any]
        let meta = p?["meta"] as? [String:Any]; let r = (try? JSONSerialization.jsonObject(with:rules)) as? [String:Any]
        func hash(_ data:Data) -> String { SHA256.hash(data:data).map{String(format:"%02x",$0)}.joined() }
        return PackProof(track:meta?["track"] as? String ?? "",contentVersion:meta?["content_version"] as? String ?? "",rulesVersion:r?["rules_version"] as? String ?? "",packSHA256:hash(pack),rulesSHA256:hash(rules),sourceCommit:source)
    }
    public static func load(pack:Data,rules:Data,catalog:Data,source:String,language:String) throws -> ApprovedLessonLibrary {
        guard pack.count <= 4_194_304,rules.count <= 1_048_576,catalog.count <= 1_048_576,["id","en"].contains(language), let raw = String(data:pack,encoding:.utf8), let rulesRaw = String(data:rules,encoding:.utf8), let p = try JSONSerialization.jsonObject(with:pack) as? [String:Any], let meta = p["meta"] as? [String:Any], meta["schema_version"] as? Int == 1, (p["synthetic"] as? Bool ?? false) == false, (meta["audiences"] as? [String])?.contains("adults") == true, (meta["instruction_langs"] as? [String])?.contains(language) == true, let items = p["items"] as? [[String:Any]], !items.isEmpty, items.count <= 10000, let screens = p["screens"] as? [[String:Any]], let prompts = p["prompts"] as? [String:[String:String]], let rulesObject = try JSONSerialization.jsonObject(with:rules) as? [String:Any], rulesObject["track"] as? String == meta["track"] as? String else { throw LearningError.noContent }
        let proof = proof(pack:pack,rules:rules,source:source); try proof.validate()
        try JSONDecoder().decode(Catalog.self,from:catalog).verify([proof],source:source)
        guard Set(items.compactMap{$0["item_id"] as? String}).count == items.count else { throw LearningError.noContent }
        let approvedScreens = screens.filter { $0["review_status"] as? String == "approved" && ($0["audience"] == nil || $0["audience"] as? String == "adults") }
        var grouped:[String:[LessonItem]] = [:]
        var unsupportedUnits = Set<String>()
        for item in items {
            guard item["review_status"] as? String == "approved", item["audience"] as? String == "adults" else { continue }
            guard let unit = item["unit"] as? String,validID(unit) else { throw LearningError.noContent }
            if item["type"] as? String == "daily_puzzle" { continue }
            guard ["choose","true_false","number_input","estimate_slider","match_pairs","tiles","fill_blank","order","info_card","mini_reading"].contains(item["type"] as? String ?? "") else { unsupportedUnits.insert(unit); continue }
            guard item["review_status"] as? String == "approved", item["audience"] as? String == "adults", let id = item["item_id"] as? String, validID(id), let unit = item["unit"] as? String, validID(unit), let type = item["type"] as? String, ["choose","true_false","number_input","estimate_slider","match_pairs","tiles","fill_blank","order","info_card","mini_reading"].contains(type), let promptID = item["prompt_id"] as? String, let prompt = prompts[promptID]?[language], !prompt.isEmpty else { throw LearningError.noContent }
            var options:[LessonOption] = []
            if ["choose","true_false","match_pairs","tiles","fill_blank","order"].contains(type) {
                guard let rawOptions = item["options"] as? [[String:Any]], !rawOptions.isEmpty, rawOptions.count <= 100 else { throw LearningError.noContent }
                for option in rawOptions { guard let oid = option["id"] as? String, validID(oid), let text = option["text"] as? [String:String], let title = text[language], !title.isEmpty else { throw LearningError.noContent }; options.append(LessonOption(id:oid,title:title)) }
                guard Set(options.map(\.id)).count == options.count else { throw LearningError.noContent }
            }
            var slider:LessonSlider?
            if type == "estimate_slider" { guard let range = item["slider"] as? [String:Double],let min = range["min"],let max = range["max"],min.isFinite,max.isFinite,min < max,let step = range["step"],step.isFinite,step > 0 else { throw LearningError.noContent }; slider = LessonSlider(min:min,max:max,step:step) }
            let pairs = item["solution_pairs"] as? [String:String] ?? [:]
            if type == "match_pairs" { guard !pairs.isEmpty,pairs.allSatisfy({ key,value in options.contains{$0.id == key} && options.contains{$0.id == value} }),Set(pairs.keys).isDisjoint(with:Set(pairs.values)) else { throw LearningError.noContent } }
            grouped[unit,default:[]].append(LessonItem(id:id,type:type,prompt:prompt,help:(item["help_lines"] as? [[String:Any]] ?? []).compactMap{($0["meaning"] as? [String:String])?[language]},modelAnswer:(item["model_answer"] as? [String:String])?[language],options:options,slider:slider,leftIDs:options.filter{pairs[$0.id] != nil}.map(\.id),rightIDs:options.filter{Set(pairs.values).contains($0.id)}.map(\.id)))
        }
        let title = (meta["title"] as? [String:String])?[language] ?? proof.track
        let lessons = grouped.keys.sorted().filter { unit in !unsupportedUnits.contains(unit) && !screens.contains(where:{ $0["unit"] as? String == unit && $0["review_status"] as? String != "approved" }) }.map { unit in
            let selectedScreens = approvedScreens.filter{$0["unit"] as? String == unit}
            let introduction = selectedScreens.filter{$0["unit"] as? String == unit}.flatMap { screen in (screen["body"] as? [[String:String]] ?? []).compactMap{$0[language]} }
            return ApprovedLesson(id:proof.track+":"+unit,title:title+" · "+unit,proof:proof,language:language,introduction:introduction,screens:selectedScreens.compactMap { screen in guard let id = screen["screen_id"] as? String,validID(id),let title = (screen["title"] as? [String:String])?[language] else { return nil }; return LessonScreen(id:id,title:title,body:(screen["body"] as? [[String:String]] ?? []).compactMap{$0[language]}) },items:grouped[unit]!,packJSON:raw,rulesJSON:rulesRaw,feedback:(p["feedback"] as? [String:[String:String]] ?? [:]).compactMapValues{$0[language]})
        }
        return ApprovedLessonLibrary(lessons:lessons)
    }
}
@MainActor public final class LessonSession {
    public let lesson:ApprovedLesson
    public var position:Int { saved.snapshot.step }
    /// Steps planned for this session (the core's queue, which can grow when a focus question is added), as Android shows it.
    public var total:Int { (((try? JSONSerialization.jsonObject(with:Data(saved.snapshot.stateJSON.utf8))) as? [String:Any])?["queue"] as? [Any])?.count ?? 0 }
    public var isDone:Bool { saved.snapshot.phase == "done" }
    public var current:LessonItem? { saved.snapshot.phase == "step" ? lesson.items.first{$0.id == saved.snapshot.currentItemID}:nil }
    public var lastFeedback:[String] { saved.snapshot.feedbackMessages + saved.snapshot.feedbackIDs.compactMap{lesson.feedback[$0]} }
    public var canAdvance:Bool { ["screen","feedback"].contains(saved.snapshot.phase) }
    public var currentScreen:LessonScreen? { lesson.screens.first{$0.id == saved.snapshot.screenID} }
    private let learning:LearningStore; private let core:SharedLessonCore; private let scope:OwnerScope
    private var questionStartedAt = ProcessInfo.processInfo.systemUptime
    private var saved:SavedLearningSession
    private var frozenAttempt:(response:String,payload:String,next:SavedLearningSession)?
    public init(lesson:ApprovedLesson,learning:LearningStore,core:SharedLessonCore) throws {
        guard core.isAvailable,let scope = learning.scope else { throw LearningError.gradingUnavailable }
        try learning.requireScope(scope)
        self.lesson = lesson; self.learning = learning; self.core = core; self.scope = scope
        if let old = try learning.savedLesson(),old.lessonID == lesson.id {
            guard old.proof == lesson.proof,old.language == lesson.language,old.coreVersion == core.versionID else { throw LearningError.noContent }
            try Self.validate(old.snapshot,lesson:lesson); saved = old
        } else {
            let sessionID = UUID().uuidString.lowercased()
            let contextValues:[String:String] = ["screens_seen":String(data:try JSONSerialization.data(withJSONObject:learning.seenScreens(proof:lesson.proof)),encoding:.utf8)!,"session_id":sessionID,"unit":String(lesson.id.split(separator:":").last ?? ""),"lang":lesson.language,"learner_id":try learning.selectedLearner().client_learner_id,"app_version":Bundle.main.object(forInfoDictionaryKey:"CFBundleShortVersionString") as? String ?? "0.2","zone_id":TimeZone.current.identifier,"timestamp":Self.timestamp()]
            let context = String(data:try JSONSerialization.data(withJSONObject:contextValues,options:.sortedKeys),encoding:.utf8)!
            let snapshot = try core.start(packJSON:lesson.packJSON,rulesJSON:lesson.rulesJSON,contextJSON:context,historyJSON:learning.historyJSON())
            try Self.validate(snapshot,lesson:lesson)
            saved = SavedLearningSession(lessonID:lesson.id,proof:lesson.proof,language:lesson.language,coreVersion:core.versionID,sessionID:sessionID,snapshot:snapshot)
            try learning.saveInitialLesson(saved)
        }
    }
    private static func timestamp() -> String { let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime,.withFractionalSeconds]; return formatter.string(from:Date()) }
    private static func validate(_ state:SharedSessionSnapshot,lesson:ApprovedLesson) throws {
        guard state.stateJSON.utf8.count <= 1048576,(try JSONSerialization.jsonObject(with:Data(state.stateJSON.utf8))) is [String:Any],state.step >= 0,state.step <= 10000,state.feedbackIDs.count <= 100,state.feedbackIDs.allSatisfy({lesson.feedback[$0] != nil}),["step","screen","feedback","done"].contains(state.phase),state.completed == (state.phase == "done"),state.phase != "step" || state.currentItemID != nil,state.phase != "screen" || state.screenID != nil,state.screenID == nil || lesson.screens.contains(where:{$0.id == state.screenID}),state.currentItemID == nil || lesson.items.contains(where:{$0.id == state.currentItemID}),state.feedbackMessages.count <= 100,state.feedbackMessages.allSatisfy({$0.utf8.count <= 8192}) else { throw LearningError.invalidData }
    }
    public func advance() throws {
        try learning.requireScope(scope); guard canAdvance else { throw LearningError.invalidData }
        let nextSnapshot = try core.advance(packJSON:lesson.packJSON,rulesJSON:lesson.rulesJSON,stateJSON:saved.snapshot.stateJSON,contextJSON:String(data:try JSONSerialization.data(withJSONObject:["timestamp":Self.timestamp(),"learner_id":try learning.selectedLearner().client_learner_id,"session_id":saved.sessionID]),encoding:.utf8)!)
        try Self.validate(nextSnapshot,lesson:lesson)
        let next = SavedLearningSession(lessonID:saved.lessonID,proof:saved.proof,language:saved.language,coreVersion:saved.coreVersion,sessionID:saved.sessionID,snapshot:nextSnapshot)
        try learning.commitLessonTransition(previous:saved,next:next); saved = next; questionStartedAt = ProcessInfo.processInfo.systemUptime
    }
    public func submit(responseJSON:String) throws {
        try learning.requireScope(scope); guard let item = current else { throw LearningError.noContent }
        let payload:String; let next:SavedLearningSession
        if let frozenAttempt { guard frozenAttempt.response == responseJSON else { throw LearningError.immutableConflict }; payload = frozenAttempt.payload; next = frozenAttempt.next }
        else {
            let answerID = UUID().uuidString.lowercased()
            let localDate = DateFormatter(); localDate.locale = Locale(identifier:"en_US_POSIX"); localDate.timeZone = .current; localDate.dateFormat = "yyyy-MM-dd"
            let context:[String:String] = ["time_on_item_ms":String(max(0,Int((ProcessInfo.processInfo.systemUptime-questionStartedAt)*1000))),"answer_id":answerID,"learner_id":try learning.selectedLearner().client_learner_id,"session_id":saved.sessionID,"timestamp":Self.timestamp(),"local_date":localDate.string(from:Date()),"app_version":Bundle.main.object(forInfoDictionaryKey:"CFBundleShortVersionString") as? String ?? "0.2","lang":lesson.language]
            let contextJSON = String(data:try JSONSerialization.data(withJSONObject:context,options:.sortedKeys),encoding:.utf8)!
            let assessed = try core.submit(packJSON:lesson.packJSON,rulesJSON:lesson.rulesJSON,stateJSON:saved.snapshot.stateJSON,responseJSON:responseJSON,contextJSON:contextJSON,historyJSON:learning.historyJSON())
            payload = assessed.eventPayload; try Self.validate(assessed.next,lesson:lesson)
            let event = try NativeAnswer.parse(payload,learner:learning.selectedLearner(),proof:lesson.proof)
            guard event.answer_id == answerID,event.session_id == saved.sessionID,event.item_id == item.id,NSDictionary(dictionary:try JSONSerialization.jsonObject(with:Data(event.raw_response.utf8)) as! [String:Any]).isEqual(to:try JSONSerialization.jsonObject(with:Data(responseJSON.utf8)) as! [String:Any]) else { throw LearningError.invalidData }
            next = SavedLearningSession(lessonID:saved.lessonID,proof:saved.proof,language:saved.language,coreVersion:saved.coreVersion,sessionID:saved.sessionID,snapshot:assessed.next)
            frozenAttempt = (responseJSON,payload,next)
        }
        try learning.commitLessonAnswer(payload,proof:lesson.proof,previous:saved,next:next)
        saved = next; questionStartedAt = ProcessInfo.processInfo.systemUptime; frozenAttempt = nil
    }
}
