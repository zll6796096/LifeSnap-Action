import SwiftUI

// MARK: - Success View

struct SuccessView: View {
    let task: CalendarTask
    let onScanAgain: () -> Void

    var body: some View {
        ZStack {
            AppTheme.screen
                .ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    VStack(alignment: .leading, spacing: 12) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 52, weight: .semibold))
                            .foregroundStyle(.green)
                            .accessibilityHidden(true)

                        Text("カレンダーに追加しました")
                            .font(.largeTitle.bold())
                            .foregroundStyle(.primary)
                            .fixedSize(horizontal: false, vertical: true)

                        Text("追加した予定は、システムカレンダーで確認できます。")
                            .font(.body)
                            .foregroundStyle(.secondary)
                    }

                    eventSummary
                }
                .padding(.horizontal, 20)
                .padding(.top, 28)
                .padding(.bottom, 24)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
            }
        }
        .safeAreaInset(edge: .bottom) {
            actions
        }
    }

    private var eventSummary: some View {
        VStack(spacing: 0) {
            LabeledValueRow(
                icon: "calendar",
                label: "タイトル",
                value: task.title
            )

            Divider()

            LabeledValueRow(
                icon: "clock",
                label: "日時",
                value: formattedDate
            )

            if !task.location.isEmpty {
                Divider()

                LabeledValueRow(
                    icon: "mappin",
                    label: "場所",
                    value: task.location
                )
            }
        }
        .padding(.horizontal, 16)
        .background(AppTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var actions: some View {
        VStack(spacing: 8) {
            Button(action: openCalendarApp) {
                PrimaryActionLabel(
                    title: "カレンダーで確認",
                    systemImage: "calendar.badge.checkmark"
                )
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.roundedRectangle(radius: 14))
            .tint(AppTheme.accent)

            Button("別の書類を追加", action: onScanAgain)
                .font(.body.weight(.medium))
                .frame(maxWidth: .infinity)
                .frame(minHeight: 44)
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 8)
        .background(.bar)
    }

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
        let timestamp = task.startDate.timeIntervalSinceReferenceDate
        if let url = URL(string: "calshow:\(timestamp)") {
            UIApplication.shared.open(url)
        }
    }
}
