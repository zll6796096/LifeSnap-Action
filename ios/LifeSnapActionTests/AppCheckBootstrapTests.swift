import XCTest
@testable import LifeSnapAction

final class AppCheckBootstrapTests: XCTestCase {
    func testDebugBuildUsesOnlyDebugMode() {
        #if DEBUG
        XCTAssertEqual(AppCheckBuildMode.current, .debug)
        #else
        XCTAssertEqual(AppCheckBuildMode.current, .appAttest)
        #endif
    }
}
