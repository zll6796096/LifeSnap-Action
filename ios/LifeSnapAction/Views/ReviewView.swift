import SwiftUI

// MARK: - Review View

struct ReviewView: View {
    let sourceImage: UIImage?
    @Bindable var task: CalendarTask
    @Bindable var calendarVM: CalendarViewModel
    let onConfirm: () -> Void
    let onBack: () -> Void

    @State private var isEditing = ProcessInfo.processInfo.environment[
        "LIFESNAP_UI_EDITING"
    ] == "true"
    @State private var showConfirmDialog = false

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

                    if task.isPastDate {
                        warningBanner
                    }

                    taskSection

                    if task.amount > 0 || !task.issuer.isEmpty {
                        contextSection
                    }
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
        .onAppear {
            calendarVM.checkAuthorization()
        }
        .alert("カレンダーへのアクセス", isPresented: $calendarVM.showSettingsAlert) {
            Button("設定を開く") { calendarVM.openSettings() }
            Button("キャンセル", role: .cancel) {}
        } message: {
            Text("カレンダーにイベントを追加するには、設定でカレンダーへのアクセスを許可してください。")
        }
        .confirmationDialog(
            "カレンダーに追加しますか？",
            isPresented: $showConfirmDialog,
            titleVisibility: .visible
        ) {
            Button("追加する") {
                addEventToCalendar()
            }
            Button("キャンセル", role: .cancel) {}
        } message: {
            Text("\(task.title) を\nシステムカレンダーに追加します。")
        }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: 16) {
            Text("予定の確認")
                .font(.largeTitle.bold())
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)

            Spacer(minLength: 8)

            Button(isEditing ? "完了" : "編集") {
                isEditing.toggle()
            }
            .font(.body.weight(.medium))
            .frame(minWidth: 44, minHeight: 44)
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

    @ViewBuilder
    private var taskSection: some View {
        if isEditing {
            editForm
                .appSectionStyle()
        } else {
            readOnlySummary
        }
    }

    private var readOnlySummary: some View {
        VStack(spacing: 0) {
            LabeledValueRow(
                icon: "doc.text",
                label: "タイトル",
                value: task.title.isEmpty ? "未設定" : task.title
            )

            Divider()

            LabeledValueRow(
                icon: "calendar",
                label: "日時",
                value: formattedDateRange
            )

            Divider()

            LabeledValueRow(
                icon: "mappin",
                label: "場所",
                value: task.location.isEmpty ? "未設定" : task.location,
                valueStyle: task.location.isEmpty
                    ? AnyShapeStyle(Color.secondary)
                    : AnyShapeStyle(Color.primary)
            )

            Divider()

            LabeledValueRow(
                icon: "text.alignleft",
                label: "メモ",
                value: task.description.isEmpty ? "未設定" : task.description,
                valueStyle: task.description.isEmpty
                    ? AnyShapeStyle(Color.secondary)
                    : AnyShapeStyle(Color.primary)
            )
        }
        .padding(.horizontal, 16)
        .background(AppTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var editForm: some View {
        VStack(alignment: .leading, spacing: 18) {
            editorRow(label: "タイトル", icon: "doc.text") {
                TextField("タイトルを入力", text: $task.title)
                    .textFieldStyle(.roundedBorder)
                    .font(.body)
            }

            Divider()

            editorRow(label: "日時", icon: "calendar") {
                VStack(spacing: 12) {
                    Toggle("終日", isOn: $task.isAllDay)
                        .tint(AppTheme.accent)

                    DatePicker(
                        "開始",
                        selection: $task.startDate,
                        displayedComponents: task.isAllDay ? [.date] : [.date, .hourAndMinute]
                    )
                    .tint(AppTheme.accent)

                    if !task.isAllDay {
                        DatePicker(
                            "終了",
                            selection: Binding(
                                get: { task.endDate ?? task.startDate.addingTimeInterval(3600) },
                                set: { task.endDate = $0 }
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

    private var contextSection: some View {
        VStack(spacing: 0) {
            if task.amount > 0 {
                LabeledValueRow(
                    icon: "yensign.circle",
                    label: "金額",
                    value: "¥\(Int(task.amount))"
                )
            }

            if task.amount > 0 && !task.issuer.isEmpty {
                Divider()
            }

            if !task.issuer.isEmpty {
                LabeledValueRow(
                    icon: "building.2",
                    label: "発行元",
                    value: task.issuer
                )
            }
        }
        .padding(.horizontal, 16)
        .background(AppTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var warningBanner: some View {
        Label("この日時は過去です", systemImage: "exclamationmark.triangle.fill")
            .font(.footnote.weight(.medium))
            .foregroundStyle(.orange)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(AppTheme.warningSurface)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var bottomActions: some View {
        VStack(spacing: 8) {
            Button {
                if calendarVM.isAuthorized {
                    showConfirmDialog = true
                } else {
                    Task { await calendarVM.requestAccess() }
                }
            } label: {
                PrimaryActionLabel(
                    title: calendarVM.isAuthorized
                        ? "カレンダーに追加"
                        : "カレンダーの使用を許可",
                    systemImage: calendarVM.isAuthorized
                        ? "calendar.badge.plus"
                        : "lock.shield"
                )
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.roundedRectangle(radius: 14))
            .tint(AppTheme.accent)

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

    private var formattedDateRange: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ja_JP")

        if task.isAllDay {
            formatter.dateFormat = "yyyy年M月d日(E)"
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
