import SwiftUI

// MARK: - Processing View

struct ProcessingView: View {
    let error: String?
    let onCancel: () -> Void
    let onRetry: () -> Void

    var body: some View {
        ZStack {
            AppTheme.screen
                .ignoresSafeArea()

            VStack(spacing: 28) {
                Spacer()

                if let error {
                    errorView(message: error)
                } else {
                    loadingView
                }

                Spacer()

                Button("キャンセル", action: onCancel)
                    .font(.body.weight(.medium))
                    .frame(minHeight: 44)
                    .padding(.bottom, 24)
            }
            .padding(.horizontal, 24)
            .frame(maxWidth: 560)
        }
    }

    private var loadingView: some View {
        VStack(spacing: 18) {
            ProgressView()
                .controlSize(.large)
                .tint(AppTheme.accent)
                .accessibilityLabel("予定を読み取り中")

            Text("予定を読み取っています")
                .font(.title2.bold())
                .foregroundStyle(.primary)
                .multilineTextAlignment(.center)

            Text("日付・時間・場所を確認しています")
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
    }

    private func errorView(message: String) -> some View {
        VStack(spacing: 18) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 44))
                .foregroundStyle(.red)
                .accessibilityHidden(true)

            Text("読み取りできませんでした")
                .font(.title2.bold())
                .foregroundStyle(.primary)
                .multilineTextAlignment(.center)

            Text(message)
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)

            Button(action: onRetry) {
                PrimaryActionLabel(
                    title: "もう一度送信を確認",
                    systemImage: "arrow.clockwise"
                )
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.roundedRectangle(radius: 14))
            .tint(AppTheme.accent)
            .padding(.top, 6)
        }
    }
}
