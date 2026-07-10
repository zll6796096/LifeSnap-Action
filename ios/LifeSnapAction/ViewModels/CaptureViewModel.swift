import SwiftUI
import PhotosUI

// MARK: - Capture ViewModel

/// Orchestrates camera and photo picker for image capture.
@Observable
final class CaptureViewModel {
    var selectedImage: UIImage?
    var showCamera = false
    var showPhotoPicker = false
    var selectedPhotoItem: PhotosPickerItem?

    /// Reset state for a new capture session.
    func reset() {
        selectedImage = nil
        selectedPhotoItem = nil
    }

    /// Process a selected PhotosPickerItem into a UIImage.
    func loadImage(from item: PhotosPickerItem?) async {
        guard let item else { return }
        do {
            if let data = try await item.loadTransferable(type: Data.self),
               let image = UIImage(data: data) {
                await MainActor.run {
                    self.selectedImage = image
                }
            }
        } catch {
            print("Failed to load image from picker: \(error)")
        }
    }

    /// Set image directly (from camera).
    func setImage(_ image: UIImage) {
        selectedImage = image
    }

    /// Release the in-memory image after cancellation or successful upload processing.
    func clearPendingImage() {
        selectedImage = nil
        selectedPhotoItem = nil
    }
}
