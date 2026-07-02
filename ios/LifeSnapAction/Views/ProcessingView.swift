import SwiftUI

// MARK: - Processing View

/// Loading screen shown while Gemini analyzes the image.
struct ProcessingView: View {
    let error: String?
    let onCancel: () -> Void
    let onRetry: () -> Void

    @State private var rotation: Double = 0
    @State private var pulse: Bool = false

    var body: some View {
        ZStack {
            Color(hex: "0F0F1A")
                .ignoresSafeArea()

            VStack(spacing: 32) {
                Spacer()

                if let error {
                    // Error state
                    errorView(message: error)
                } else {
                    // Loading state
                    loadingView
                }

                Spacer()

                // Cancel / Back button
                Button {
                    onCancel()
                } label: {
                    Text("キャンセル")
                        .font(.subheadline)
                        .foregroundColor(.white.opacity(0.5))
                }
                .padding(.bottom, 40)
            }
        }
    }

    // MARK: - Loading View

    private var loadingView: some View {
        VStack(spacing: 24) {
            // Animated scanning icon
            ZStack {
                Circle()
                    .stroke(Color(hex: "6C63FF").opacity(0.2), lineWidth: 3)
                    .frame(width: 100, height: 100)

                Circle()
                    .trim(from: 0, to: 0.3)
                    .stroke(
                        LinearGradient(
                            colors: [Color(hex: "6C63FF"), Color(hex: "48C6EF")],
                            startPoint: .leading,
                            endPoint: .trailing
                        ),
                        style: StrokeStyle(lineWidth: 3, lineCap: .round)
                    )
                    .frame(width: 100, height: 100)
                    .rotationEffect(.degrees(rotation))

                Image(systemName: "doc.text.magnifyingglass")
                    .font(.system(size: 36, weight: .light))
                    .foregroundColor(Color(hex: "6C63FF"))
                    .scaleEffect(pulse ? 1.1 : 1.0)
            }

            Text("書類を解析中...")
                .font(.title3.weight(.medium))
                .foregroundColor(.white)

            Text("AIが予定情報を抽出しています")
                .font(.subheadline)
                .foregroundColor(.white.opacity(0.5))
        }
        .onAppear {
            withAnimation(.linear(duration: 1.5).repeatForever(autoreverses: false)) {
                rotation = 360
            }
            withAnimation(.easeInOut(duration: 1.0).repeatForever(autoreverses: true)) {
                pulse = true
            }
        }
    }

    // MARK: - Error View

    private func errorView(message: String) -> some View {
        VStack(spacing: 20) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 48))
                .foregroundColor(Color(hex: "FF6B6B"))

            Text("解析エラー")
                .font(.title3.weight(.semibold))
                .foregroundColor(.white)

            Text(message)
                .font(.subheadline)
                .foregroundColor(.white.opacity(0.6))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            Button {
                onRetry()
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "arrow.clockwise")
                    Text("もう一度試す")
                }
                .font(.headline)
                .padding(.horizontal, 32)
                .padding(.vertical, 14)
                .background(Color(hex: "6C63FF"))
                .foregroundColor(.white)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .padding(.top, 8)
        }
    }
}
