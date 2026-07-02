import EventKit

// MARK: - Calendar Service

/// Wraps EventKit for system calendar integration.
final class CalendarService {
    static let shared = CalendarService()

    private let eventStore = EKEventStore()

    private init() {}

    // MARK: - Authorization

    enum AuthorizationStatus {
        case authorized
        case denied
        case notDetermined
    }

    /// Current calendar authorization status.
    var authorizationStatus: AuthorizationStatus {
        let status = EKEventStore.authorizationStatus(for: .event)
        switch status {
        case .authorized, .fullAccess, .writeOnly:
            return .authorized
        case .denied, .restricted:
            return .denied
        case .notDetermined:
            return .notDetermined
        @unknown default:
            return .denied
        }
    }

    /// Request calendar write access.
    /// Uses writeOnly on iOS 17+, full access on iOS 16.
    func requestAccess() async -> Bool {
        if #available(iOS 17.0, *) {
            do {
                return try await eventStore.requestWriteOnlyAccessToEvents()
            } catch {
                print("Calendar access request failed: \(error)")
                return false
            }
        } else {
            do {
                return try await eventStore.requestAccess(to: .event)
            } catch {
                print("Calendar access request failed: \(error)")
                return false
            }
        }
    }

    // MARK: - Event Creation

    /// Add a CalendarTask to the system calendar.
    /// - Returns: The created EKEvent's eventIdentifier.
    func addEvent(from task: CalendarTask) throws -> String {
        let event = EKEvent(eventStore: eventStore)
        event.title = task.title
        event.location = task.location.isEmpty ? nil : task.location
        event.notes = buildNotes(from: task)

        if task.isAllDay {
            event.isAllDay = true
            event.startDate = task.startDate
            event.endDate = task.endDate ?? task.startDate
        } else {
            event.startDate = task.startDate
            event.endDate = task.endDate ?? task.startDate.addingTimeInterval(3600)
        }

        // Use default calendar, or first writable calendar
        if let defaultCal = eventStore.defaultCalendarForNewEvents {
            event.calendar = defaultCal
        } else if let firstCal = eventStore.calendars(for: .event).first(where: { $0.allowsContentModifications }) {
            event.calendar = firstCal
        } else {
            throw CalendarError.noCalendarAvailable
        }

        try eventStore.save(event, span: .thisEvent)
        return event.eventIdentifier
    }

    // MARK: - Helpers

    private func buildNotes(from task: CalendarTask) -> String {
        var parts: [String] = []

        if !task.description.isEmpty {
            parts.append(task.description)
        }
        if task.amount > 0 {
            let formatted = NumberFormatter.localizedString(from: NSNumber(value: task.amount), number: .currency)
            parts.append("【金額】\(formatted)")
        }
        if !task.issuer.isEmpty {
            parts.append("【発行元】\(task.issuer)")
        }
        parts.append("— Created by LifeSnap Action")

        return parts.joined(separator: "\n")
    }
}

// MARK: - Calendar Errors

enum CalendarError: LocalizedError {
    case noCalendarAvailable
    case permissionDenied

    var errorDescription: String? {
        switch self {
        case .noCalendarAvailable:
            return "利用可能なカレンダーが見つかりません。設定アプリでカレンダーを確認してください。"
        case .permissionDenied:
            return "カレンダーへのアクセスが許可されていません。設定アプリで許可してください。"
        }
    }
}
