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
        calendarVM: CalendarViewModel = CalendarViewModel()
    ) {
        self.captureVM = captureVM
        self.extractionVM = extractionVM
        self.calendarVM = calendarVM
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
}
