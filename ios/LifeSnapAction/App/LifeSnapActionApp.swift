import SwiftUI

// MARK: - App Entry Point

@main
struct LifeSnapActionApp: App {
    init() {
        AppCheckBootstrap.configure()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(\.locale, Locale(identifier: "ja_JP"))
        }
    }
}

// MARK: - Content View (Navigation Root)

struct ContentView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var coordinator = ContentView.makeCoordinator()

    var body: some View {
        Group {
            switch coordinator.currentScreen {
            case .capture:
                CaptureView(viewModel: coordinator.captureVM) { image in
                    coordinator.imageSelected(image)
                }

            case .consent(let purpose):
                if let image = coordinator.captureVM.selectedImage {
                    UploadConsentView(
                        image: image,
                        purpose: purpose,
                        onAgree: {
                            Task {
                                await coordinator.startConsentedExtraction()
                            }
                        },
                        onCancel: {
                            coordinator.cancelConsent()
                        }
                    )
                } else {
                    CaptureView(viewModel: coordinator.captureVM) { image in
                        coordinator.imageSelected(image)
                    }
                    .onAppear {
                        coordinator.resetToCapture()
                    }
                }

            case .processing:
                ProcessingView(
                    error: coordinator.extractionVM.error,
                    onCancel: { coordinator.cancelProcessing() },
                    onRetry: {
                        coordinator.requestRetryConsent()
                    }
                )

            case .review(let task):
                ReviewView(
                    sourceImage: coordinator.reviewImage,
                    task: task,
                    calendarVM: coordinator.calendarVM,
                    onConfirm: {
                        coordinator.showSuccess(for: task)
                    },
                    onBack: { coordinator.resetToCapture() }
                )

            case .needsReview(let task):
                NeedsReviewView(
                    sourceImage: coordinator.reviewImage,
                    task: task,
                    onConfirm: { editedTask in
                        editedTask.route = .calendarAction
                        coordinator.currentScreen = .review(editedTask)
                    },
                    onBack: { coordinator.resetToCapture() }
                )

            case .noAction:
                NoActionView(onScanAgain: { coordinator.resetToCapture() })

            case .success(let task):
                SuccessView(
                    task: task,
                    onScanAgain: { coordinator.resetToCapture() }
                )
            }
        }
        .animation(
            reduceMotion ? nil : .easeInOut(duration: 0.25),
            value: screenKey
        )
    }

    // MARK: - Navigation Helpers

    private var screenKey: String {
        switch coordinator.currentScreen {
        case .capture: return "capture"
        case .consent: return "consent"
        case .processing: return "processing"
        case .review: return "review"
        case .needsReview: return "needsReview"
        case .noAction: return "noAction"
        case .success: return "success"
        }
    }

    @MainActor
    private static func makeCoordinator() -> AppFlowCoordinator {
        #if DEBUG
        let environment = ProcessInfo.processInfo.environment
        let scenario = environment["LIFESNAP_UI_SCENARIO"]
            .flatMap(VerificationScenario.init(rawValue:))
        let image = environment["LIFESNAP_UI_IMAGE_PATH"]
            .flatMap(UIImage.init(contentsOfFile:))

        return AppFlowCoordinator(
            verificationScenario: scenario,
            verificationImage: image
        )
        #else
        return AppFlowCoordinator()
        #endif
    }
}
