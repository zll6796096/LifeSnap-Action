import Foundation

// MARK: - API Response Model

/// Maps to the JSON response from POST /api/extract
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
    let details: String?
}
