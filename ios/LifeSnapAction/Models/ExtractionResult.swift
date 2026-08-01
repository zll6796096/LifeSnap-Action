import Foundation

// MARK: - API Response Model

/// Maps to the JSON response from POST /api/v2/extract
struct ExtractionResponse: Codable {
    let route: Route
    let documentType: String?
    let taskType: String?
    let title: String?
    let dueDate: String?
    let startDatetime: String?
    let endDatetime: String?
    let amount: Double?
    let issuer: String?
    let location: String?
    let summary: String?
    let confidence: Double?
    let riskFlags: [String]?
    let evidence: String?
    let calendarEvent: CalendarEventData?

    enum CodingKeys: String, CodingKey {
        case route
        case documentType = "document_type"
        case taskType = "task_type"
        case title
        case dueDate = "due_date"
        case startDatetime = "start_datetime"
        case endDatetime = "end_datetime"
        case amount, issuer, location, summary
        case confidence
        case riskFlags = "risk_flags"
        case evidence
        case calendarEvent = "calendar_event"
    }
}

/// Route classification from Gemini
enum Route: String, Codable {
    case calendarAction = "calendar_action"
    case needsReview = "needs_review"
    case noActionDetected = "no_action_detected"
}

/// Pre-built calendar event fields from Gemini
struct CalendarEventData: Codable {
    let title: String
    let start: String
    let end: String?
    let description: String?
    let location: String?
}

// MARK: - API Error Response

struct APIErrorResponse: Codable {
    let error: String
    let code: String?
}

// MARK: - Stable User-Facing API Errors

enum APIError: LocalizedError, Equatable {
    case invalidConfiguration
    case invalidResponse
    case badRequest
    case serviceUnavailable
    case serverError(statusCode: Int)
    case installationIDInvalid
    case appCheckInvalid
    case appCheckReplayed
    case appIDForbidden
    case installationRateLimited
    case installationDailyLimited
    case serviceDailyLimited
    case securityVerificationUnavailable
    case imageTooLarge
    case unsupportedImageType
    case networkUnavailable

    var errorDescription: String? {
        switch self {
        case .invalidConfiguration:
            return "通信先の設定が無効です。アプリを再インストールしてください。"
        case .invalidResponse:
            return "サーバーからの応答を確認できませんでした。もう一度お試しください。"
        case .badRequest:
            return "画像を読み取れませんでした。別の画像でもう一度お試しください。"
        case .serviceUnavailable:
            return "サービスが一時的に利用できません。しばらくしてからもう一度お試しください。"
        case .serverError:
            return "サーバーで問題が発生しました。しばらくしてからもう一度お試しください。"
        case .installationIDInvalid:
            return "安全確認に失敗しました。アプリを再起動してもう一度お試しください。"
        case .appCheckInvalid:
            return "セキュリティ確認に失敗しました。もう一度お試しください。"
        case .appCheckReplayed:
            return "安全確認に失敗しました。もう一度画像を選び直してください。"
        case .appIDForbidden:
            return "このアプリのバージョンでは利用できません。最新版に更新してください。"
        case .installationRateLimited:
            return "短時間の読み取り回数が上限に達しました。少し待ってからお試しください。"
        case .installationDailyLimited:
            return "本日の読み取り回数が上限に達しました。明日もう一度お試しください。"
        case .serviceDailyLimited:
            return "本日のサービス利用上限に達しました。明日もう一度お試しください。"
        case .securityVerificationUnavailable:
            return "安全確認を利用できません。しばらくしてからもう一度お試しください。"
        case .imageTooLarge:
            return "画像のサイズが大きすぎます。10MB以下の画像を選んでください。"
        case .unsupportedImageType:
            return "この画像形式は利用できません。JPEG、PNG、またはWebPの画像を選んでください。"
        case .networkUnavailable:
            return "通信に失敗しました。通信環境を確認して、もう一度お試しください。"
        }
    }
}
