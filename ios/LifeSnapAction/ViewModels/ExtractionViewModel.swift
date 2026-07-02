import SwiftUI

// MARK: - Extraction ViewModel

/// Manages the API call to extract event data from an image.
@Observable
final class ExtractionViewModel {
    var isLoading = false
    var extraction: ExtractionResponse?
    var error: String?

    /// Send image to backend for Gemini extraction.
    func extract(image: UIImage) async {
        guard let imageData = ImageCompressor.compress(image) else {
            await MainActor.run {
                self.error = "画像の圧縮に失敗しました。別の画像をお試しください。"
            }
            return
        }

        await MainActor.run {
            self.isLoading = true
            self.error = nil
            self.extraction = nil
        }

        do {
            let result = try await APIClient.extractEvent(from: imageData)
            await MainActor.run {
                self.extraction = result
                self.isLoading = false
            }
        } catch {
            await MainActor.run {
                self.error = error.localizedDescription
                self.isLoading = false
            }
        }
    }

    /// Reset state for a new extraction.
    func reset() {
        isLoading = false
        extraction = nil
        error = nil
    }
}
