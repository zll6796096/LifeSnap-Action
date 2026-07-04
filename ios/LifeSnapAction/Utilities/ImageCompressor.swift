import UIKit

// MARK: - Image Compressor

/// Compresses UIImage to JPEG data within a target file size.
enum ImageCompressor {
    /// Target maximum file size in bytes (2 MB)
    static let maxFileSize: Int = 2 * 1024 * 1024

    /// Maximum image dimension (pixels) before downscaling
    static let maxDimension: CGFloat = 2048

    /// Compress a UIImage to JPEG data ≤ maxFileSize.
    /// - Parameter image: Source UIImage from camera or photo picker
    /// - Returns: JPEG data ready for upload
    static func compress(_ image: UIImage) -> Data? {
        // Step 1: Downscale if too large
        let scaled = downscale(image, maxDimension: maxDimension)

        // Step 2: Binary search for optimal JPEG quality
        let quality: CGFloat = 0.8
        var data = scaled.jpegData(compressionQuality: quality)

        // If already small enough, return
        if let d = data, d.count <= maxFileSize {
            return d
        }

        // Binary search between 0.1 and current quality
        var low: CGFloat = 0.1
        var high: CGFloat = quality

        for _ in 0..<6 { // 6 iterations is plenty
            let mid = (low + high) / 2
            data = scaled.jpegData(compressionQuality: mid)
            if let d = data, d.count <= maxFileSize {
                low = mid // can try higher quality
            } else {
                high = mid // need lower quality
            }
        }

        // Final pass at the best quality that fits
        return scaled.jpegData(compressionQuality: low)
    }

    /// Downscale an image so its longest side ≤ maxDimension.
    private static func downscale(_ image: UIImage, maxDimension: CGFloat) -> UIImage {
        let size = image.size
        let longest = max(size.width, size.height)

        guard longest > maxDimension else { return image }

        let scale = maxDimension / longest
        let newSize = CGSize(
            width: floor(size.width * scale),
            height: floor(size.height * scale)
        )

        let renderer = UIGraphicsImageRenderer(size: newSize)
        return renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: newSize))
        }
    }
}
