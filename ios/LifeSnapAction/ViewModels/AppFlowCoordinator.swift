import SwiftUI

// MARK: - App Flow State

enum ConsentPurpose: Equatable {
    case firstUpload
    case retryUpload

    var primaryButtonTitle: String {
        switch self {
        case .firstUpload:
            return "同意して続ける"
        case .retryUpload:
            return "同意してもう一度試す"
        }
    }
}

enum AppScreen {
    case capture
    case consent(ConsentPurpose)
    case processing
    case review(CalendarTask)
    case needsReview(CalendarTask)
    case noAction
    case success(CalendarTask)
}

enum VerificationScenario: String {
    case consent
    case processing
    case review
    case needsReview
    case noAction
    case success
}

@MainActor
@Observable
final class AppFlowCoordinator {
    var currentScreen: AppScreen = .capture
    var captureVM: CaptureViewModel
    var extractionVM: ExtractionViewModel
    var calendarVM: CalendarViewModel
    var reviewImage: UIImage?

    init(
        captureVM: CaptureViewModel = CaptureViewModel(),
        extractionVM: ExtractionViewModel = ExtractionViewModel(),
        calendarVM: CalendarViewModel = CalendarViewModel(),
        verificationScenario: VerificationScenario? = nil,
        verificationImage: UIImage? = nil
    ) {
        self.captureVM = captureVM
        self.extractionVM = extractionVM
        self.calendarVM = calendarVM

        if let verificationScenario {
            configureVerificationScenario(
                verificationScenario,
                image: verificationImage
            )
        }
    }

    func imageSelected(_ image: UIImage) {
        reviewImage = nil
        captureVM.setImage(image)
        extractionVM.reset()
        currentScreen = .consent(.firstUpload)
    }

    func cancelConsent() {
        resetToCapture()
    }

    func cancelProcessing() {
        resetToCapture()
    }

    func requestRetryConsent() {
        guard captureVM.selectedImage != nil else {
            resetToCapture()
            return
        }

        extractionVM.reset()
        currentScreen = .consent(.retryUpload)
    }

    func startConsentedExtraction() async {
        guard let image = captureVM.selectedImage else {
            resetToCapture()
            return
        }

        currentScreen = .processing
        await extractionVM.extract(image: image)
        handleExtractionResult(submittedImage: image)
    }

    func resetToCapture() {
        reviewImage = nil
        captureVM.reset()
        extractionVM.reset()
        calendarVM.reset()
        currentScreen = .capture
    }

    func showSuccess(for task: CalendarTask) {
        reviewImage = nil
        currentScreen = .success(task)
    }

    private func handleExtractionResult(submittedImage: UIImage) {
        guard let extraction = extractionVM.extraction else { return }

        captureVM.clearPendingImage()

        switch extraction.route {
        case .calendarAction:
            reviewImage = submittedImage
            let task = CalendarTask(from: extraction)
            currentScreen = .review(task)

        case .needsReview:
            reviewImage = submittedImage
            let task = CalendarTask(from: extraction)
            currentScreen = .needsReview(task)

        case .noActionDetected:
            reviewImage = nil
            currentScreen = .noAction
        }
    }

    private func configureVerificationScenario(
        _ scenario: VerificationScenario,
        image: UIImage?
    ) {
        switch scenario {
        case .consent:
            if let image {
                captureVM.setImage(image)
                currentScreen = .consent(.firstUpload)
            }

        case .processing:
            currentScreen = .processing

        case .review:
            reviewImage = image
            currentScreen = .review(makeVerificationTask(route: .calendarAction))

        case .needsReview:
            reviewImage = image
            currentScreen = .needsReview(makeVerificationTask(route: .needsReview))

        case .noAction:
            reviewImage = nil
            currentScreen = .noAction

        case .success:
            reviewImage = nil
            currentScreen = .success(makeVerificationTask(route: .calendarAction))
        }
    }

    private func makeVerificationTask(route: Route) -> CalendarTask {
        let response = ExtractionResponse(
            route: route,
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
            riskFlags: route == .needsReview ? ["date_ambiguous"] : [],
            evidence: nil,
            calendarEvent: route == .calendarAction
                ? CalendarEventData(
                    title: "エレベーター点検",
                    start: "2026-10-25T14:00:00+09:00",
                    end: "2026-10-25T16:00:00+09:00",
                    description: "点検中はエレベーターを利用できません。",
                    location: nil
                )
                : nil
        )
        return CalendarTask(from: response)
    }
}
