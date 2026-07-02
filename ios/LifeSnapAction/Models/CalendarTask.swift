import Foundation

// MARK: - Editable Calendar Task

/// User-editable model for the review screen.
/// Created from an ExtractionResponse when route is calendar_action or needs_review.
@Observable
final class CalendarTask {
    var title: String
    var startDate: Date
    var endDate: Date?
    var isAllDay: Bool
    var location: String
    var description: String
    var issuer: String
    var amount: Double
    var confidence: Double
    var riskFlags: [String]
    var route: Route

    init(from extraction: ExtractionResponse) {
        self.title = extraction.calendarEvent?.title
            ?? extraction.title
            ?? "イベント"
        self.location = extraction.calendarEvent?.location
            ?? extraction.location
            ?? ""
        self.description = extraction.calendarEvent?.description
            ?? extraction.summary
            ?? ""
        self.issuer = extraction.issuer ?? ""
        self.amount = extraction.amount ?? 0
        self.confidence = extraction.confidence ?? 0
        self.riskFlags = extraction.riskFlags ?? []
        self.route = extraction.route

        // Parse start date
        let startString = extraction.calendarEvent?.start
            ?? extraction.startDatetime
            ?? extraction.dueDate
            ?? ""
        let (parsedStart, allDay) = CalendarTask.parseDateTime(startString)
        self.startDate = parsedStart ?? Date().addingTimeInterval(86400) // default: tomorrow
        self.isAllDay = allDay

        // Parse end date
        let endString = extraction.calendarEvent?.end
            ?? extraction.endDatetime
            ?? ""
        if !endString.isEmpty {
            let (parsedEnd, _) = CalendarTask.parseDateTime(endString)
            self.endDate = parsedEnd
        } else if !allDay {
            self.endDate = self.startDate.addingTimeInterval(3600) // default: +1 hour
        } else {
            self.endDate = nil
        }
    }

    /// Parse an ISO 8601 date/datetime string.
    /// Returns (Date?, isAllDay).
    static func parseDateTime(_ string: String) -> (Date?, Bool) {
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return (nil, false) }

        // Try full datetime first (YYYY-MM-DDTHH:mm:ss or YYYY-MM-DDTHH:mm)
        let dtFormatter = ISO8601DateFormatter()
        dtFormatter.formatOptions = [.withInternetDateTime]
        if let date = dtFormatter.date(from: trimmed) {
            return (date, false)
        }

        // Try YYYY-MM-DDTHH:mm (no seconds, no timezone)
        let shortFormatter = DateFormatter()
        shortFormatter.dateFormat = "yyyy-MM-dd'T'HH:mm"
        shortFormatter.timeZone = TimeZone.current
        if let date = shortFormatter.date(from: trimmed) {
            return (date, false)
        }

        // Try YYYY-MM-DDTHH:mm:ss (no timezone)
        shortFormatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        if let date = shortFormatter.date(from: trimmed) {
            return (date, false)
        }

        // Try date only (YYYY-MM-DD) → all-day event
        shortFormatter.dateFormat = "yyyy-MM-dd"
        if let date = shortFormatter.date(from: trimmed) {
            return (date, true)
        }

        return (nil, false)
    }

    /// Whether the start date has already passed.
    var isPastDate: Bool {
        startDate < Date()
    }

    /// Whether this task has a valid date for calendar creation.
    var hasValidDate: Bool {
        true // startDate is always set (defaults to tomorrow)
    }
}
