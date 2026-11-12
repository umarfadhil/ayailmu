#if REQUIRE_SHARED_CORE && !canImport(AyaIlmuSharedLearning)
#error("Required shared Kotlin learning framework is missing. Build SharedLearningCore first.")
#endif
import Foundation
import AyaIlmuCore
#if canImport(AyaIlmuSharedLearning)
import AyaIlmuSharedLearning
/// No decisions here: the ABI returns actual shared Session snapshots/events/projections.
final class KotlinSharedLessonCore:SharedLessonCore {
    private let bridge = LearningBridge()
    var isAvailable:Bool { true }
    var versionID:String { bridge.versionID }
    func start(packJSON:String,rulesJSON:String,contextJSON:String,historyJSON:String) throws -> SharedSessionSnapshot {
        try JSONDecoder().decode(SharedSessionSnapshot.self,from:Data(try bridge.start(packJSON:packJSON,rulesJSON:rulesJSON,contextJSON:contextJSON,historyJSON:historyJSON).utf8))
    }
    func submit(packJSON:String,rulesJSON:String,stateJSON:String,responseJSON:String,contextJSON:String,historyJSON:String) throws -> SharedSubmission {
        struct Result:Decodable { let eventPayload:String; let next:SharedSessionSnapshot }
        let result = try JSONDecoder().decode(Result.self,from:Data(try bridge.submit(packJSON:packJSON,rulesJSON:rulesJSON,stateJSON:stateJSON,responseJSON:responseJSON,contextJSON:contextJSON,historyJSON:historyJSON).utf8))
        return SharedSubmission(eventPayload:result.eventPayload,next:result.next)
    }
    func advance(packJSON:String,rulesJSON:String,stateJSON:String,contextJSON:String) throws -> SharedSessionSnapshot {
        try JSONDecoder().decode(SharedSessionSnapshot.self,from:Data(try bridge.advance(packJSON:packJSON,rulesJSON:rulesJSON,stateJSON:stateJSON,contextJSON:contextJSON).utf8))
    }
    func project(packJSON:String,rulesJSON:String,historyJSON:String,contextJSON:String) throws -> String { try bridge.project(packJSON:packJSON,rulesJSON:rulesJSON,historyJSON:historyJSON,contextJSON:contextJSON) }
}
#endif
enum AppSharedCore {
    static func make() -> SharedLessonCore {
        #if canImport(AyaIlmuSharedLearning)
        return KotlinSharedLessonCore()
        #else
        return UnavailableSharedGrader()
        #endif
    }
}
