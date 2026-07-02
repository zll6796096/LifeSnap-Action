import SwiftUI

// MARK: - App Entry Point

@main
struct LifeSnapActionApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

// MARK: - App Flow State

enum AppScreen {
    case capture
    case processing
    case review(CalendarTask)
    case needsReview(CalendarTask)
    case noAction
    case success(CalendarTask)
}

// MARK: - Content View (Navigation Root)

struct ContentView: View {
    @State private var currentScreen: AppScreen = .capture
    @State private var captureVM = CaptureViewModel()
    @State private var extractionVM = ExtractionViewModel()
    @State private var calendarVM = CalendarViewModel()

    var body: some View {
        Group {
            switch currentScreen {
            case .capture:
                CaptureView(viewModel: captureVM) { image in
                    captureVM.setImage(image)
                    currentScreen = .processing
                    Task {
                        await extractionVM.extract(image: image)
                        handleExtractionResult()
                    }
                }

            case .processing:
                ProcessingView(
                    error: extractionVM.error,
                    onCancel: { resetToCapture() },
                    onRetry: {
                        if let image = captureVM.selectedImage {
                            extractionVM.reset()
                            currentScreen = .processing
                            Task {
                                await extractionVM.extract(image: image)
                                handleExtractionResult()
                            }
                        }
                    }
                )

            case .review(let task):
                ReviewView(
                    task: task,
                    calendarVM: calendarVM,
                    onConfirm: {
                        currentScreen = .success(task)
                    },
                    onBack: { resetToCapture() }
                )

            case .needsReview(let task):
                NeedsReviewView(
                    task: task,
                    onConfirm: { editedTask in
                        editedTask.route = .calendarAction
                        currentScreen = .review(editedTask)
                    },
                    onBack: { resetToCapture() }
                )

            case .noAction:
                NoActionView(onScanAgain: { resetToCapture() })

            case .success(let task):
                SuccessView(
                    task: task,
                    onScanAgain: { resetToCapture() }
                )
            }
        }
        .animation(.easeInOut(duration: 0.3), value: screenKey)
    }

    // MARK: - Navigation Helpers

    private var screenKey: String {
        switch currentScreen {
        case .capture: return "capture"
        case .processing: return "processing"
        case .review: return "review"
        case .needsReview: return "needsReview"
        case .noAction: return "noAction"
        case .success: return "success"
        }
    }

    private func resetToCapture() {
        captureVM.reset()
        extractionVM.reset()
        calendarVM.reset()
        currentScreen = .capture
    }

    private func handleExtractionResult() {
        guard let extraction = extractionVM.extraction else { return }

        switch extraction.route {
        case .calendarAction:
            let task = CalendarTask(from: extraction)
            currentScreen = .review(task)

        case .needsReview:
            let task = CalendarTask(from: extraction)
            currentScreen = .needsReview(task)

        case .noActionDetected:
            currentScreen = .noAction
        }
    }
}
