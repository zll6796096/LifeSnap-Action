import SwiftUI
import UIKit

// MARK: - Calendar ViewModel

/// Manages EventKit permission and event creation.
@Observable
final class CalendarViewModel {
    var isAuthorized = false
    var eventIdentifier: String?
    var error: String?
    var showSettingsAlert = false

    private let calendarService = CalendarService.shared

    /// Check current authorization status on appear.
    func checkAuthorization() {
        let status = calendarService.authorizationStatus
        isAuthorized = (status == .authorized)
    }

    /// Request calendar access and update state.
    func requestAccess() async {
        let granted = await calendarService.requestAccess()
        await MainActor.run {
            self.isAuthorized = granted
            if !granted {
                self.showSettingsAlert = true
            }
        }
    }

    /// Create a calendar event from the task.
    func createEvent(from task: CalendarTask) {
        do {
            let identifier = try calendarService.addEvent(from: task)
            eventIdentifier = identifier
            error = nil

            // Haptic feedback on success
            let generator = UINotificationFeedbackGenerator()
            generator.notificationOccurred(.success)
        } catch {
            self.error = error.localizedDescription

            // Haptic feedback on failure
            let generator = UINotificationFeedbackGenerator()
            generator.notificationOccurred(.error)
        }
    }

    /// Reset state for a new session.
    func reset() {
        eventIdentifier = nil
        error = nil
        showSettingsAlert = false
    }

    /// Open Settings app for calendar permission.
    func openSettings() {
        if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        }
    }
}
