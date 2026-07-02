import Foundation
import UIKit

// MARK: - API Client

/// Handles communication with the LifeSnap Action Cloud Run backend.
final class APIClient {
    /// Base URL for the API. Set via environment or defaults to production.
    static let baseURL: String = {
        if let url = ProcessInfo.processInfo.environment["API_BASE_URL"] {
            return url
        }
        // TODO: Replace with your actual Cloud Run URL
        return "https://lifesnap-action-788259830737.asia-northeast1.run.app"
    }()

    /// Request timeout in seconds
    private static let timeoutInterval: TimeInterval = 30

    // MARK: - Extract Event from Image

    /// Sends an image to the backend for Gemini extraction.
    /// - Parameter imageData: JPEG-compressed image data
    /// - Returns: Parsed ExtractionResponse
    static func extractEvent(from imageData: Data) async throws -> ExtractionResponse {
        guard let url = URL(string: "\(baseURL)/api/extract") else {
            throw APIError.invalidURL
        }

        // Build multipart/form-data request
        let boundary = UUID().uuidString
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = timeoutInterval

        // Construct multipart body
        var body = Data()
        body.append("--\(boundary)\r\n")
        body.append("Content-Disposition: form-data; name=\"image\"; filename=\"photo.jpg\"\r\n")
        body.append("Content-Type: image/jpeg\r\n\r\n")
        body.append(imageData)
        body.append("\r\n--\(boundary)--\r\n")

        request.httpBody = body

        // Send request
        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        // Handle error status codes
        switch httpResponse.statusCode {
        case 200:
            break
        case 400:
            let errorResponse = try? JSONDecoder().decode(APIErrorResponse.self, from: data)
            throw APIError.badRequest(errorResponse?.error ?? "Invalid request")
        case 503:
            throw APIError.serviceUnavailable
        default:
            let errorResponse = try? JSONDecoder().decode(APIErrorResponse.self, from: data)
            throw APIError.serverError(
                statusCode: httpResponse.statusCode,
                message: errorResponse?.error ?? "Unknown error"
            )
        }

        // Decode response
        let decoder = JSONDecoder()
        return try decoder.decode(ExtractionResponse.self, from: data)
    }

    // MARK: - Health Check

    /// Checks if the backend is reachable.
    static func healthCheck() async -> Bool {
        guard let url = URL(string: "\(baseURL)/health") else { return false }
        do {
            let (_, response) = try await URLSession.shared.data(from: url)
            return (response as? HTTPURLResponse)?.statusCode == 200
        } catch {
            return false
        }
    }
}

// MARK: - API Errors

enum APIError: LocalizedError {
    case invalidURL
    case invalidResponse
    case badRequest(String)
    case serviceUnavailable
    case serverError(statusCode: Int, message: String)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "APIのURLが無効です。"
        case .invalidResponse:
            return "サーバーからの応答が無効です。"
        case .badRequest(let message):
            return message
        case .serviceUnavailable:
            return "サービスが一時的に利用できません。しばらくしてからもう一度お試しください。"
        case .serverError(let statusCode, let message):
            return "サーバーエラー (\(statusCode)): \(message)"
        }
    }
}

// MARK: - Data Extension for Multipart

private extension Data {
    mutating func append(_ string: String) {
        if let data = string.data(using: .utf8) {
            append(data)
        }
    }
}
