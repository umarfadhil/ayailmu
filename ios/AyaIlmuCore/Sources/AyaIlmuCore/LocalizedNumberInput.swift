import Foundation
/// Input parsing only; numerical correctness and tolerance are evaluated by the shared core.
public enum LocalizedNumberInput {
    public static func parse(_ raw:String,language:String) -> Double? {
        let text = raw.trimmingCharacters(in:.whitespacesAndNewlines)
        guard ["id","en"].contains(language),text.utf8.count <= 100 else { return nil }
        let pattern = language == "id" ? "^[+-]?(?:[0-9]+|[0-9]{1,3}(?:\\.[0-9]{3})+)(?:,[0-9]+)?$" : "^[+-]?(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\\.[0-9]+)?$"
        guard text.range(of:pattern,options:.regularExpression) != nil else { return nil }
        let canonical = language == "id" ? text.replacingOccurrences(of:".",with:"").replacingOccurrences(of:",",with:"."):text.replacingOccurrences(of:",",with:"")
        guard let value = Double(canonical),value.isFinite else { return nil }; return value
    }
}
