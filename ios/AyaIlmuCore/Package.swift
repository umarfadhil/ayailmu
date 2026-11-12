// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "AyaIlmuCore", platforms: [.iOS(.v17), .macOS(.v13)], products: [.library(name: "AyaIlmuCore", targets: ["AyaIlmuCore"])], targets: [.systemLibrary(name: "CSQLite"), .target(name: "AyaIlmuCore", dependencies: ["CSQLite"]), .testTarget(name: "AyaIlmuCoreTests", dependencies: ["AyaIlmuCore"])])
