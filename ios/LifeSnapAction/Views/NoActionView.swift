import SwiftUI

// MARK: - No Action View

struct NoActionView: View {
    let onScanAgain: () -> Void

    var body: some View {
        ZStack {
            AppTheme.screen
                .ignoresSafeArea()

            VStack(spacing: 20) {
                Spacer()

                Image(systemName: "doc.questionmark")
                    .font(.system(size: 58, weight: .regular))
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)

                Text("予定は見つかりませんでした")
                    .font(.title2.bold())
                    .foregroundStyle(.primary)
                    .multilineTextAlignment(.center)

                Text("この書類には、カレンダーに追加できる日時情報が見つかりませんでした。")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)

                Spacer()

                Button(action: onScanAgain) {
                    PrimaryActionLabel(
                        title: "別の書類を選ぶ",
                        systemImage: "doc.badge.plus"
                    )
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.roundedRectangle(radius: 14))
                .tint(AppTheme.accent)
                .padding(.bottom, 24)
            }
            .padding(.horizontal, 24)
            .frame(maxWidth: 560)
        }
    }
}
