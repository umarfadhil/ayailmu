import Foundation
/// Foundation validates JSON grammar; this bounded walk additionally rejects duplicate object keys,
/// including escaped aliases, before Foundation's dictionaries could collapse them.
enum StrictJSON {
    static func object(_ raw:String,keys:Set<String>,nullable:Set<String> = []) throws -> [String:Any] {
        let data = Data(raw.utf8)
        guard let object = try JSONSerialization.jsonObject(with:data) as? [String:Any], Set(object.keys).isSubset(of:keys), !object.contains(where:{$0.value is NSNull && !nullable.contains($0.key)}) else { throw LearningError.invalidData }
        var walk = Walk(bytes:Array(data)); try walk.value(depth:0); walk.space(); guard walk.index == walk.bytes.count else { throw LearningError.invalidData }; return object
    }
    private struct Walk {
        let bytes:[UInt8]; var index = 0
        mutating func space() { while index < bytes.count && [9,10,13,32].contains(bytes[index]) { index += 1 } }
        mutating func string() throws -> String {
            let start = index; guard index < bytes.count, bytes[index] == 34 else { throw LearningError.invalidData }; index += 1
            while index < bytes.count {
                if bytes[index] == 92 { index += 2; continue }
                if bytes[index] == 34 { index += 1; return try JSONDecoder().decode(String.self,from:Data(bytes[start..<index])) }
                index += 1
            }; throw LearningError.invalidData
        }
        mutating func value(depth:Int) throws {
            guard depth <= 24 else { throw LearningError.invalidData }; space(); guard index < bytes.count else { throw LearningError.invalidData }
            if bytes[index] == 34 { _ = try string(); return }
            if bytes[index] == 123 {
                index += 1; space(); var keys = Set<String>(); if index < bytes.count && bytes[index] == 125 { index += 1; return }
                while true {
                    space(); let key = try string(); guard keys.insert(key).inserted else { throw LearningError.invalidData }; space()
                    guard index < bytes.count, bytes[index] == 58 else { throw LearningError.invalidData }; index += 1; try value(depth:depth+1); space()
                    guard index < bytes.count else { throw LearningError.invalidData }; if bytes[index] == 125 { index += 1; return }; guard bytes[index] == 44 else { throw LearningError.invalidData }; index += 1
                }
            }
            if bytes[index] == 91 {
                index += 1; space(); if index < bytes.count && bytes[index] == 93 { index += 1; return }
                while true { try value(depth:depth+1); space(); guard index < bytes.count else { throw LearningError.invalidData }; if bytes[index] == 93 { index += 1; return }; guard bytes[index] == 44 else { throw LearningError.invalidData }; index += 1 }
            }
            let start = index
            while index < bytes.count && ![9,10,13,32,44,93,125].contains(bytes[index]) { index += 1 }
            guard index > start else { throw LearningError.invalidData }
        }
    }
}
