// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "AyaIlmuCore", platforms: [.iOS(.v17), .macOS(.v13)], products: [.library(name: "AyaIlmuCore", targets: ["AyaIlmuCore"])], targets: [.target(name: "AyaIlmuCore"), .testTarget(name: "AyaIlmuCoreTests", dependencies: ["AyaIlmuCore"])])
