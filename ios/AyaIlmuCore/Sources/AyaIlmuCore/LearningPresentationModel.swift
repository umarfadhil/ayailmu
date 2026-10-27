import Foundation
import Combine
@MainActor public final class LearningPresentationModel: ObservableObject {
    @Published public private(set) var profiles:[OwnerLearner] = []
    @Published public private(set) var selected:String?; @Published public private(set) var summary:ProgressSummary?
    @Published public private(set) var projection:SharedProjectionSummary?
    @Published public private(set) var message = ""; @Published public private(set) var busy = false
    public private(set) var learning:LearningStore?
    public let library:ApprovedLessonLibrary
    public let core:SharedLessonCore
    private var generation = 0
    public init(learning:LearningStore,core:SharedLessonCore = UnavailableSharedGrader(),library:ApprovedLessonLibrary = .bundled) {
        self.learning = learning; self.core = core; self.library = library
        do { try learning.restoreOfflineProfiles(); refresh() } catch { message = "Your saved progress could not be opened. Please try again." }
    }
    public init(storageFailure:Bool) { library = .bundled; core = UnavailableSharedGrader(); message = "Your saved progress could not be opened. Please try again." }
    public func refresh() {
        profiles = learning?.profiles ?? []; selected = learning?.scope?.learner; summary = try? learning?.summary(); projection = nil
        guard let learning,core.isAvailable,let language = profiles.first(where:{$0.id == selected})?.lang else { return }
        var tracks = Set<String>(); var learned = 0; var practicing = 0; var blocked = 0; var waiting = 0
        do {
            for lesson in library.lessons where lesson.language == language && tracks.insert(lesson.proof.track).inserted {
                let value = try learning.projection(lesson:lesson,core:core)
                learned += value.learned; practicing += value.practicing; blocked += value.blocked; waiting += value.waitingForFreshContent
            }
            if !tracks.isEmpty { projection = SharedProjectionSummary(learned:learned,practicing:practicing,blocked:blocked,waitingForFreshContent:waiting) }
        } catch { if message.isEmpty { message = "Learning progress could not be verified. Please try again." } }
    }
    public func run(_ block:@escaping (LearningStore) async throws -> Void) async {
        guard let learning,!busy else { return }; let mark = generation; busy = true; message = ""; defer { if mark == generation { busy = false; refresh() } }
        do { try await block(learning) }
        catch let error as LearningError { guard mark == generation else { return }; message = error.errorDescription ?? "The action did not complete." }
        catch { guard mark == generation else { return }; message = "Cannot connect. Saved progress remains on this device. Please try again." }
    }
    public func disable() async {
        guard let learning else { return }; generation += 1; let mark = generation; busy = true; message = ""
        defer { if generation == mark { busy = false; refresh() } }
        var committedLocally = false
        do { try await learning.disableSync(localChanged:{ committedLocally = true; self.refresh() }) }
        catch { if generation == mark { message = committedLocally ? "Sync is off on this device. Account withdrawal will be retried when connected.":"Sync could not be turned off because the change could not be saved. Please try again." } }
    }
    public func select(_ id:String) { do { try learning?.select(id); message = ""; refresh() } catch { message = "This profile could not be opened." } }
    public func detach() { generation += 1; learning?.detach(); profiles = []; selected = nil; summary = nil; projection = nil }
}
