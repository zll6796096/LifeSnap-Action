import XCTest
import UIKit
@testable import LifeSnapAction

@MainActor
final class AppFlowCoordinatorTests: XCTestCase {
    func testSelectingImageDoesNotCallAPIBeforeConsent() {
        let client = MockExtractionClient()
        let coordinator = makeCoordinator(client: client)

        coordinator.imageSelected(makeImage())

        XCTAssertEqual(client.callCount, 0)
        XCTAssertNotNil(coordinator.captureVM.selectedImage)
        guard case .consent(.firstUpload) = coordinator.currentScreen else {
            return XCTFail("Expected first upload consent screen")
        }
    }

    func testCancelConsentClearsPendingImageAndDoesNotCallAPI() {
        let client = MockExtractionClient()
        let coordinator = makeCoordinator(client: client)

        coordinator.imageSelected(makeImage())
        coordinator.cancelConsent()

        XCTAssertEqual(client.callCount, 0)
        XCTAssertNil(coordinator.captureVM.selectedImage)
        guard case .capture = coordinator.currentScreen else {
            return XCTFail("Expected capture screen after cancel")
        }
    }

    func testAgreeCallsAPIExactlyOnceAndClearsPendingImageOnSuccess() async {
        let client = MockExtractionClient(result: .success(makeNoActionResponse()))
        let coordinator = makeCoordinator(client: client)

        coordinator.imageSelected(makeImage())
        await coordinator.startConsentedExtraction()

        XCTAssertEqual(client.callCount, 1)
        XCTAssertNil(coordinator.captureVM.selectedImage)
        XCTAssertNil(coordinator.reviewImage)
        guard case .noAction = coordinator.currentScreen else {
            return XCTFail("Expected no-action screen after successful extraction")
        }
    }

    func testCalendarRouteMovesImageIntoTransientReviewState() async {
        let client = MockExtractionClient(result: .success(makeCalendarResponse()))
        let coordinator = makeCoordinator(client: client)

        coordinator.imageSelected(makeImage())
        await coordinator.startConsentedExtraction()

        XCTAssertNil(coordinator.captureVM.selectedImage)
        XCTAssertNotNil(coordinator.reviewImage)
        guard case .review = coordinator.currentScreen else {
            return XCTFail("Expected review screen")
        }
    }

    func testShowingSuccessClearsTransientReviewImage() async {
        let client = MockExtractionClient(result: .success(makeCalendarResponse()))
        let coordinator = makeCoordinator(client: client)

        coordinator.imageSelected(makeImage())
        await coordinator.startConsentedExtraction()
        guard case .review(let task) = coordinator.currentScreen else {
            return XCTFail("Expected review screen")
        }

        coordinator.showSuccess(for: task)

        XCTAssertNil(coordinator.reviewImage)
        guard case .success = coordinator.currentScreen else {
            return XCTFail("Expected success screen")
        }
    }

    func testResetClearsTransientReviewImage() async {
        let client = MockExtractionClient(result: .success(makeCalendarResponse()))
        let coordinator = makeCoordinator(client: client)

        coordinator.imageSelected(makeImage())
        await coordinator.startConsentedExtraction()
        coordinator.resetToCapture()

        XCTAssertNil(coordinator.reviewImage)
        guard case .capture = coordinator.currentScreen else {
            return XCTFail("Expected capture screen after reset")
        }
    }

    func testVerificationReviewScenarioUsesProvidedImage() {
        let image = makeImage()

        let coordinator = AppFlowCoordinator(
            verificationScenario: .review,
            verificationImage: image
        )

        XCTAssertNotNil(coordinator.reviewImage)
        guard case .review = coordinator.currentScreen else {
            return XCTFail("Expected review verification screen")
        }
    }

    func testVerificationNoActionScenarioDoesNotRetainImage() {
        let coordinator = AppFlowCoordinator(
            verificationScenario: .noAction,
            verificationImage: makeImage()
        )

        XCTAssertNil(coordinator.reviewImage)
        guard case .noAction = coordinator.currentScreen else {
            return XCTFail("Expected no-action verification screen")
        }
    }

    func testRetryRequiresConsentBeforeUploadingAgain() async {
        let client = MockExtractionClient(result: .failure(MockError.failed))
        let coordinator = makeCoordinator(client: client)

        coordinator.imageSelected(makeImage())
        await coordinator.startConsentedExtraction()

        XCTAssertEqual(client.callCount, 1)
        XCTAssertNotNil(coordinator.captureVM.selectedImage)
        guard case .processing = coordinator.currentScreen else {
            return XCTFail("Expected processing error state after failed extraction")
        }

        coordinator.requestRetryConsent()

        XCTAssertEqual(client.callCount, 1)
        guard case .consent(.retryUpload) = coordinator.currentScreen else {
            return XCTFail("Expected retry consent before second upload")
        }
    }

    func testPrivacyURLUsesCurrentProductionBackend() {
        XCTAssertEqual(
            APIClient.privacyPolicyURL.absoluteString,
            "https://lifesnap-action-sxielk4wua-an.a.run.app/privacy"
        )
    }

    func testConsentCopyContainsRequiredDisclosureAndActions() {
        let body = ConsentCopy.disclosureBody

        XCTAssertTrue(body.contains("Google Gemini"))
        XCTAssertTrue(body.contains("Google Cloud Run"))
        XCTAssertTrue(body.contains("氏名"))
        XCTAssertTrue(body.contains("住所"))
        XCTAssertTrue(body.contains("金額"))
        XCTAssertTrue(body.contains("予定・タスク情報を抽出する目的"))
        XCTAssertTrue(body.contains("永続保存しません"))
        XCTAssertTrue(body.contains("Google 製品の改善に使用されません"))
        XCTAssertTrue(body.contains("キャンセルすると画像は送信されず"))
        XCTAssertEqual(ConsentPurpose.firstUpload.primaryButtonTitle, "同意して続ける")
        XCTAssertEqual(ConsentPurpose.retryUpload.primaryButtonTitle, "同意してもう一度試す")
        XCTAssertEqual(ConsentCopy.cancelButtonTitle, "キャンセル")
        XCTAssertEqual(ConsentCopy.privacyLinkTitle, "プライバシーポリシー")
    }

    private func makeCoordinator(client: MockExtractionClient) -> AppFlowCoordinator {
        AppFlowCoordinator(extractionVM: ExtractionViewModel(apiClient: client))
    }

    private func makeImage() -> UIImage {
        UIGraphicsImageRenderer(size: CGSize(width: 8, height: 8)).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 8, height: 8))
        }
    }

}

private enum MockError: Error {
    case failed
}

private final class MockExtractionClient: ImageExtractionClient {
    var callCount = 0
    var result: Result<ExtractionResponse, Error>

    init(result: Result<ExtractionResponse, Error> = .success(makeNoActionResponse())) {
        self.result = result
    }

    func extractEvent(from imageData: Data) async throws -> ExtractionResponse {
        callCount += 1
        return try result.get()
    }
}

private func makeNoActionResponse() -> ExtractionResponse {
    ExtractionResponse(
        route: .noActionDetected,
        documentType: "test",
        taskType: nil,
        title: nil,
        dueDate: nil,
        startDatetime: nil,
        endDatetime: nil,
        amount: nil,
        issuer: nil,
        location: nil,
        summary: nil,
        confidence: nil,
        riskFlags: nil,
        evidence: nil,
        calendarEvent: nil
    )
}

private func makeCalendarResponse() -> ExtractionResponse {
    ExtractionResponse(
        route: .calendarAction,
        documentType: "notice",
        taskType: "event",
        title: "エレベーター点検",
        dueDate: nil,
        startDatetime: "2026-10-25T14:00:00+09:00",
        endDatetime: "2026-10-25T16:00:00+09:00",
        amount: nil,
        issuer: "管理会社",
        location: nil,
        summary: "点検中はエレベーターを利用できません。",
        confidence: 0.91,
        riskFlags: [],
        evidence: nil,
        calendarEvent: CalendarEventData(
            title: "エレベーター点検",
            start: "2026-10-25T14:00:00+09:00",
            end: "2026-10-25T16:00:00+09:00",
            description: "点検中はエレベーターを利用できません。",
            location: nil
        )
    )
}
