import SwiftUI

// MARK: - Success View

/// Shown after successfully adding an event to the system calendar.
struct SuccessView: View {
    let task: CalendarTask
    let onScanAgain: () -> Void

    @State private var checkmarkScale: CGFloat = 0
    @State private var contentOpacity: Double = 0

    var body: some View {
        ZStack {
            Color(hex: "0F0F1A")
                .ignoresSafeArea()

            VStack(spacing: 32) {
                Spacer()

                // Success animation
                VStack(spacing: 24) {
                    // Checkmark circle
                    ZStack {
                        Circle()
                            .fill(Color(hex: "4ADE80").opacity(0.15))
                            .frame(width: 120, height: 120)

                        Circle()
                            .fill(Color(hex: "4ADE80").opacity(0.3))
                            .frame(width: 90, height: 90)

                        Image(systemName: "checkmark")
                            .font(.system(size: 40, weight: .bold))
                            .foregroundColor(Color(hex: "4ADE80"))
                    }
                    .scaleEffect(checkmarkScale)

                    Text("カレンダーに追加しました")
                        .font(.title2.weight(.bold))
                        .foregroundColor(.white)
                        .opacity(contentOpacity)
                }

                // Event summary card
                VStack(spacing: 12) {
                    HStack {
                        Image(systemName: "calendar")
                            .foregroundColor(Color(hex: "6C63FF"))
                        Text(task.title)
                            .font(.headline)
                            .foregroundColor(.white)
                        Spacer()
                    }

                    HStack {
                        Image(systemName: "clock")
                            .foregroundColor(.white.opacity(0.4))
                        Text(formattedDate)
                            .font(.subheadline)
                            .foregroundColor(.white.opacity(0.6))
                        Spacer()
                    }

                    if !task.location.isEmpty {
                        HStack {
                            Image(systemName: "mappin")
                                .foregroundColor(.white.opacity(0.4))
                            Text(task.location)
                                .font(.subheadline)
                                .foregroundColor(.white.opacity(0.6))
                            Spacer()
                        }
                    }
                }
                .padding(20)
                .background(Color.white.opacity(0.05))
                .clipShape(RoundedRectangle(cornerRadius: 16))
                .padding(.horizontal, 24)
                .opacity(contentOpacity)

                Spacer()

                // Action buttons
                VStack(spacing: 16) {
                    // Open Calendar app
                    Button {
                        openCalendarApp()
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "calendar.badge.checkmark")
                            Text("カレンダーで確認")
                                .font(.headline)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 18)
                        .background(
                            LinearGradient(
                                colors: [Color(hex: "6C63FF"), Color(hex: "5A54E0")],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .foregroundColor(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                    }

                    // Scan again
                    Button {
                        onScanAgain()
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "camera.fill")
                            Text("もう一度スキャン")
                                .font(.headline)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 18)
                        .background(Color.white.opacity(0.08))
                        .foregroundColor(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                        .overlay(
                            RoundedRectangle(cornerRadius: 16)
                                .stroke(Color.white.opacity(0.15), lineWidth: 1)
                        )
                    }
                }
                .padding(.horizontal, 24)
                .padding(.bottom, 40)
                .opacity(contentOpacity)
            }
        }
        .onAppear {
            withAnimation(.spring(response: 0.5, dampingFraction: 0.6).delay(0.1)) {
                checkmarkScale = 1.0
            }
            withAnimation(.easeOut(duration: 0.4).delay(0.4)) {
                contentOpacity = 1.0
            }
        }
    }

    // MARK: - Helpers

    private var formattedDate: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")

        if task.isAllDay {
            formatter.dateStyle = .long
            return formatter.string(from: task.startDate) + "（終日）"
        }

        formatter.dateFormat = "M月d日(E) HH:mm"
        var result = formatter.string(from: task.startDate)
        if let end = task.endDate {
            formatter.dateFormat = "HH:mm"
            result += " 〜 " + formatter.string(from: end)
        }
        return result
    }

    private func openCalendarApp() {
        // calshow: opens Calendar app at the event's date
        let timestamp = task.startDate.timeIntervalSinceReferenceDate
        if let url = URL(string: "calshow:\(timestamp)") {
            UIApplication.shared.open(url)
        }
    }
}
