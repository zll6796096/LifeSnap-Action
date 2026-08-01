import SwiftUI

// MARK: - Needs Review View

struct NeedsReviewView: View {
    let sourceImage: UIImage?
    @Bindable var task: CalendarTask
    let onConfirm: (CalendarTask) -> Void
    let onBack: () -> Void

    @State private var hasConfirmedDate = false

    var body: some View {
        ZStack {
            AppTheme.screen
                .ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    header

                    if let sourceImage {
                        sourceDocument(image: sourceImage)
                    }

                    if !task.riskFlags.isEmpty {
                        reviewNotice
                    }

                    editForm
                        .appSectionStyle()
                }
                .padding(.horizontal, 20)
                .padding(.top, 24)
                .padding(.bottom, 24)
                .frame(maxWidth: 680)
                .frame(maxWidth: .infinity)
            }
        }
        .safeAreaInset(edge: .bottom) {
            bottomActions
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("確認が必要です")
                .font(.largeTitle.bold())
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)

            Text("日時や内容を確認し、必要な項目を修正してください。")
                .font(.body)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func sourceDocument(image: UIImage) -> some View {
        HStack(spacing: 18) {
            DocumentThumbnail(image: image, maxWidth: 116, maxHeight: 150)

            Text("読み取った書類")
                .font(.title3)
                .foregroundStyle(.secondary)

            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    private var reviewNotice: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("要確認", systemImage: "exclamationmark.triangle.fill")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.orange)

            ForEach(task.riskFlags, id: \.self) { flag in
                Text(localizedRiskFlag(flag))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(AppTheme.warningSurface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var editForm: some View {
        VStack(alignment: .leading, spacing: 18) {
            editorRow(label: "タイトル", icon: "doc.text") {
                TextField("タイトルを入力", text: $task.title)
                    .textFieldStyle(.roundedBorder)
                    .font(.body)
            }

            Divider()

            editorRow(label: "日時（必須）", icon: "calendar") {
                VStack(spacing: 12) {
                    Toggle("終日", isOn: $task.isAllDay)
                        .tint(AppTheme.accent)
                        .onChange(of: task.isAllDay) { _, _ in
                            hasConfirmedDate = true
                        }

                    DatePicker(
                        "開始",
                        selection: $task.startDate,
                        displayedComponents: task.isAllDay ? [.date] : [.date, .hourAndMinute]
                    )
                    .tint(AppTheme.accent)
                    .onChange(of: task.startDate) { _, _ in
                        hasConfirmedDate = true
                    }

                    if !task.isAllDay {
                        DatePicker(
                            "終了",
                            selection: Binding(
                                get: { task.endDate ?? task.startDate.addingTimeInterval(3600) },
                                set: {
                                    task.endDate = $0
                                    hasConfirmedDate = true
                                }
                            ),
                            displayedComponents: [.date, .hourAndMinute]
                        )
                        .tint(AppTheme.accent)
                    }
                }
                .font(.body)
            }

            Divider()

            editorRow(label: "場所", icon: "mappin") {
                TextField("場所を入力", text: $task.location)
                    .textFieldStyle(.roundedBorder)
                    .font(.body)
            }

            Divider()

            editorRow(label: "メモ", icon: "text.alignleft") {
                TextEditor(text: $task.description)
                    .font(.body)
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 96)
                    .padding(6)
                    .background(Color(uiColor: .tertiarySystemGroupedBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 9, style: .continuous)
                            .stroke(AppTheme.separator.opacity(0.45), lineWidth: 0.5)
                    }
                    .accessibilityLabel("メモ")
            }
        }
    }

    private var bottomActions: some View {
        VStack(spacing: 8) {
            Button {
                onConfirm(task)
            } label: {
                PrimaryActionLabel(
                    title: hasConfirmedDate
                        ? "確認して追加画面へ"
                        : "日時を確認してください",
                    systemImage: hasConfirmedDate
                        ? "checkmark.circle"
                        : "calendar.badge.exclamationmark"
                )
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.roundedRectangle(radius: 14))
            .tint(AppTheme.accent)
            .disabled(!hasConfirmedDate)

            Button("やり直す", action: onBack)
                .font(.body.weight(.medium))
                .frame(maxWidth: .infinity)
                .frame(minHeight: 44)
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 8)
        .background(.bar)
    }

    @ViewBuilder
    private func editorRow<Content: View>(
        label: String,
        icon: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(label, systemImage: icon)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.secondary)

            content()
        }
    }

    private func localizedRiskFlag(_ flag: String) -> String {
        switch flag {
        case "date_ambiguous":
            return "日時を確認してください"
        case "amount_estimated":
            return "金額は推定値です"
        case "partial_ocr":
            return "読み取れなかった文字があります"
        case "low_confidence":
            return "内容をもう一度確認してください"
        default:
            return "内容を確認してください"
        }
    }
}
