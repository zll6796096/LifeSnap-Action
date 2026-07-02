import SwiftUI

// MARK: - Needs Review View

/// Shown when Gemini returns route = needs_review.
/// Forces the user to manually confirm/edit fields before adding to calendar.
struct NeedsReviewView: View {
    @Bindable var task: CalendarTask
    let onConfirm: (CalendarTask) -> Void
    let onBack: () -> Void

    @State private var hasEditedDate = false

    var body: some View {
        ZStack {
            Color(hex: "0F0F1A")
                .ignoresSafeArea()

            ScrollView {
                VStack(spacing: 20) {
                    // Warning header
                    warningHeader

                    // Risk flags
                    if !task.riskFlags.isEmpty {
                        riskFlagsList
                    }

                    // Editable fields (always in edit mode)
                    editableCard

                    // Confirm button (disabled until date edited)
                    confirmButton

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
    }

    // MARK: - Warning Header

    private var warningHeader: some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 40))
                .foregroundColor(Color(hex: "FBBF24"))

            Text("確認が必要です")
                .font(.title2.weight(.bold))
                .foregroundColor(.white)

            Text("日付や内容が不明確です。\n確認して修正してください。")
                .font(.subheadline)
                .foregroundColor(.white.opacity(0.6))
                .multilineTextAlignment(.center)
        }
        .padding(.vertical, 8)
    }

    // MARK: - Risk Flags

    private var riskFlagsList: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(task.riskFlags, id: \.self) { flag in
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.circle.fill")
                        .font(.caption)
                        .foregroundColor(Color(hex: "FF6B6B"))
                    Text(localizedRiskFlag(flag))
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.7))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color(hex: "FF6B6B").opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Editable Card

    private var editableCard: some View {
        VStack(spacing: 16) {
            // Title
            fieldEditor(label: "タイトル", icon: "doc.text") {
                TextField("タイトルを入力", text: $task.title)
                    .font(.subheadline)
                    .foregroundColor(.white)
                    .textFieldStyle(.plain)
            }

            Divider().background(Color.white.opacity(0.1))

            // Date & Time
            VStack(spacing: 12) {
                HStack {
                    Image(systemName: "calendar")
                        .foregroundColor(Color(hex: "FBBF24"))
                        .frame(width: 24)
                    Text("日時（必須）")
                        .font(.caption.weight(.medium))
                        .foregroundColor(Color(hex: "FBBF24"))
                    Spacer()
                }

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
                .onChange(of: task.startDate) { _, _ in
                    hasEditedDate = true
                }

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
            }

            Divider().background(Color.white.opacity(0.1))

            // Location
            fieldEditor(label: "場所", icon: "mappin") {
                TextField("場所を入力", text: $task.location)
                    .font(.subheadline)
                    .foregroundColor(.white)
                    .textFieldStyle(.plain)
            }

            Divider().background(Color.white.opacity(0.1))

            // Description
            fieldEditor(label: "メモ", icon: "text.alignleft") {
                TextEditor(text: $task.description)
                    .font(.subheadline)
                    .foregroundColor(.white)
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 60)
            }
        }
        .padding(20)
        .background(Color.white.opacity(0.05))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color(hex: "FBBF24").opacity(0.3), lineWidth: 1)
        )
    }

    // MARK: - Confirm Button

    private var confirmButton: some View {
        Button {
            onConfirm(task)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: hasEditedDate ? "checkmark.circle.fill" : "pencil.circle")
                Text(hasEditedDate ? "確認完了 — 追加画面へ" : "日時を設定してください")
                    .font(.headline)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 18)
            .background(
                hasEditedDate
                    ? LinearGradient(
                        colors: [Color(hex: "6C63FF"), Color(hex: "5A54E0")],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                    : LinearGradient(
                        colors: [Color.gray.opacity(0.3), Color.gray.opacity(0.3)],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
            )
            .foregroundColor(hasEditedDate ? .white : .white.opacity(0.4))
            .clipShape(RoundedRectangle(cornerRadius: 16))
        }
        .disabled(!hasEditedDate)
        .padding(.top, 8)
    }

    // MARK: - Helpers

    @ViewBuilder
    private func fieldEditor<Content: View>(
        label: String,
        icon: String,
        @ViewBuilder content: () -> Content
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
            content()
        }
    }

    private func localizedRiskFlag(_ flag: String) -> String {
        switch flag {
        case "date_ambiguous": return "日付が不明確です"
        case "amount_estimated": return "金額が推定値です"
        case "partial_ocr": return "一部テキストが読み取れませんでした"
        case "low_confidence": return "抽出の信頼度が低いです"
        default: return flag
        }
    }
}
