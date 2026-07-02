import SwiftUI

// MARK: - Review View

/// Editable task card with confirm-and-add-to-calendar flow.
struct ReviewView: View {
    @Bindable var task: CalendarTask
    @Bindable var calendarVM: CalendarViewModel
    let onConfirm: () -> Void
    let onBack: () -> Void

    @State private var isEditing = false
    @State private var showConfirmDialog = false

    var body: some View {
        ZStack {
            Color(hex: "0F0F1A")
                .ignoresSafeArea()

            ScrollView {
                VStack(spacing: 20) {
                    // Header
                    headerView

                    // Confidence badge
                    confidenceBadge

                    // Past date warning
                    if task.isPastDate {
                        warningBanner(text: "⚠️ この日付は過去です")
                    }

                    // Task card
                    taskCard

                    // Context info (read-only)
                    if task.amount > 0 || !task.issuer.isEmpty {
                        contextCard
                    }

                    // Add to calendar button
                    addToCalendarButton

                    // Back button
                    Button { onBack() } label: {
                        Text("やり直す")
                            .font(.subheadline)
                            .foregroundColor(.white.opacity(0.5))
                    }
                    .padding(.bottom, 32)
                }
                .padding(.horizontal, 20)
                .padding(.top, 16)
            }
        }
        .onAppear {
            calendarVM.checkAuthorization()
        }
        .alert("カレンダーへのアクセス", isPresented: $calendarVM.showSettingsAlert) {
            Button("設定を開く") { calendarVM.openSettings() }
            Button("キャンセル", role: .cancel) {}
        } message: {
            Text("カレンダーにイベントを追加するには、設定でカレンダーへのアクセスを許可してください。")
        }
        .confirmationDialog("カレンダーに追加しますか？", isPresented: $showConfirmDialog, titleVisibility: .visible) {
            Button("追加する") {
                addEventToCalendar()
            }
            Button("キャンセル", role: .cancel) {}
        } message: {
            Text("\(task.title) を\nシステムカレンダーに追加します。")
        }
    }

    // MARK: - Header

    private var headerView: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("抽出結果")
                    .font(.title2.weight(.bold))
                    .foregroundColor(.white)
                Text("内容を確認して、カレンダーに追加できます")
                    .font(.caption)
                    .foregroundColor(.white.opacity(0.5))
            }
            Spacer()
            Button {
                isEditing.toggle()
            } label: {
                Text(isEditing ? "完了" : "修正する")
                    .font(.subheadline.weight(.medium))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(Color.white.opacity(0.1))
                    .foregroundColor(Color(hex: "48C6EF"))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    // MARK: - Confidence Badge

    private var confidenceBadge: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(confidenceColor)
                .frame(width: 8, height: 8)
            Text("信頼度: \(Int(task.confidence * 100))%")
                .font(.caption.weight(.medium))
                .foregroundColor(confidenceColor)
            Spacer()
        }
    }

    private var confidenceColor: Color {
        if task.confidence >= 0.8 { return Color(hex: "4ADE80") }
        if task.confidence >= 0.5 { return Color(hex: "FBBF24") }
        return Color(hex: "FF6B6B")
    }

    // MARK: - Task Card

    private var taskCard: some View {
        VStack(spacing: 16) {
            // Title
            editableField(label: "タイトル", text: $task.title, icon: "doc.text")

            Divider().background(Color.white.opacity(0.1))

            // Date & Time
            VStack(spacing: 12) {
                HStack {
                    Image(systemName: "calendar")
                        .foregroundColor(Color(hex: "6C63FF"))
                        .frame(width: 24)
                    Text("日時")
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.5))
                    Spacer()
                }

                if isEditing {
                    Toggle("終日", isOn: $task.isAllDay)
                        .font(.subheadline)
                        .foregroundColor(.white)
                        .tint(Color(hex: "6C63FF"))

                    DatePicker(
                        "開始",
                        selection: $task.startDate,
                        displayedComponents: task.isAllDay ? [.date] : [.date, .hourAndMinute]
                    )
                    .font(.subheadline)
                    .foregroundColor(.white)
                    .tint(Color(hex: "6C63FF"))

                    if !task.isAllDay {
                        DatePicker(
                            "終了",
                            selection: Binding(
                                get: { task.endDate ?? task.startDate.addingTimeInterval(3600) },
                                set: { task.endDate = $0 }
                            ),
                            displayedComponents: [.date, .hourAndMinute]
                        )
                        .font(.subheadline)
                        .foregroundColor(.white)
                        .tint(Color(hex: "6C63FF"))
                    }
                } else {
                    Text(formattedDateRange)
                        .font(.subheadline)
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }

            Divider().background(Color.white.opacity(0.1))

            // Location
            editableField(label: "場所", text: $task.location, icon: "mappin")

            Divider().background(Color.white.opacity(0.1))

            // Description
            editableField(label: "メモ", text: $task.description, icon: "text.alignleft", multiline: true)
        }
        .padding(20)
        .background(Color.white.opacity(0.05))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
        )
    }

    // MARK: - Context Card

    private var contextCard: some View {
        VStack(spacing: 12) {
            if task.amount > 0 {
                HStack {
                    Image(systemName: "yensign.circle")
                        .foregroundColor(Color(hex: "FBBF24"))
                    Text("金額")
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.5))
                    Spacer()
                    Text("¥\(Int(task.amount))")
                        .font(.subheadline.weight(.medium))
                        .foregroundColor(.white)
                }
            }
            if !task.issuer.isEmpty {
                HStack {
                    Image(systemName: "building.2")
                        .foregroundColor(Color(hex: "48C6EF"))
                    Text("発行元")
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.5))
                    Spacer()
                    Text(task.issuer)
                        .font(.subheadline)
                        .foregroundColor(.white)
                }
            }
        }
        .padding(16)
        .background(Color.white.opacity(0.03))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Add to Calendar Button

    private var addToCalendarButton: some View {
        Button {
            if calendarVM.isAuthorized {
                showConfirmDialog = true
            } else {
                Task { await calendarVM.requestAccess() }
            }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: calendarVM.isAuthorized ? "calendar.badge.plus" : "lock.shield")
                Text(calendarVM.isAuthorized ? "カレンダーに追加" : "カレンダーへのアクセスを許可")
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
        .padding(.top, 8)
    }

    // MARK: - Helpers

    @ViewBuilder
    private func editableField(
        label: String,
        text: Binding<String>,
        icon: String,
        multiline: Bool = false
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: icon)
                    .foregroundColor(Color(hex: "6C63FF"))
                    .frame(width: 24)
                Text(label)
                    .font(.caption)
                    .foregroundColor(.white.opacity(0.5))
                Spacer()
            }

            if isEditing {
                if multiline {
                    TextEditor(text: text)
                        .font(.subheadline)
                        .foregroundColor(.white)
                        .scrollContentBackground(.hidden)
                        .frame(minHeight: 60)
                } else {
                    TextField(label, text: text)
                        .font(.subheadline)
                        .foregroundColor(.white)
                        .textFieldStyle(.plain)
                }
            } else {
                Text(text.wrappedValue.isEmpty ? "—" : text.wrappedValue)
                    .font(.subheadline)
                    .foregroundColor(text.wrappedValue.isEmpty ? .white.opacity(0.3) : .white)
            }
        }
    }

    private func warningBanner(text: String) -> some View {
        HStack {
            Text(text)
                .font(.caption.weight(.medium))
                .foregroundColor(Color(hex: "FBBF24"))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(Color(hex: "FBBF24").opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var formattedDateRange: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")

        if task.isAllDay {
            formatter.dateStyle = .long
            return formatter.string(from: task.startDate) + "（終日）"
        }

        formatter.dateFormat = "yyyy年M月d日(E) HH:mm"
        var result = formatter.string(from: task.startDate)
        if let end = task.endDate {
            formatter.dateFormat = "HH:mm"
            result += " 〜 " + formatter.string(from: end)
        }
        return result
    }

    private func addEventToCalendar() {
        calendarVM.createEvent(from: task)
        if calendarVM.eventIdentifier != nil {
            onConfirm()
        }
    }
}
