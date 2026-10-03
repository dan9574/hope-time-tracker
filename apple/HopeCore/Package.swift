// swift-tools-version: 6.0
// Everything in Hope's Apple apps that is not UI: records, local store, timer rules, sync.
// Builds and tests on macOS with `swift test`; the iOS and watchOS apps link it as a local package.
import PackageDescription

let package = Package(
    name: "HopeCore",
    platforms: [.iOS(.v18), .watchOS(.v11), .macOS(.v15)],
    products: [.library(name: "HopeCore", targets: ["HopeCore"])],
    targets: [
        .target(name: "HopeCore"),
        .testTarget(name: "HopeCoreTests", dependencies: ["HopeCore"]),
    ]
)
