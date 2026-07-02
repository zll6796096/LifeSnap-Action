import SwiftUI

// MARK: - No Action View

/// Neutral screen shown when Gemini finds no actionable event in the image.
struct NoActionView: View {
    let onScanAgain: () -> Void

    @State private var appeared = false

    var body: some View {
        ZStack {
            Color(hex: "0F0F1A")
                .ignoresSafeArea()

            VStack(spacing: 32) {
                Spacer()

                // Illustration
                VStack(spacing: 20) {
                    Image(systemName: "doc.questionmark")
                        .font(.system(size: 64, weight: .thin))
                        .foregroundStyle(
                            LinearGradient(
                                colors: [Color.white.opacity(0.4), Color.white.opacity(0.2)],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                        .scaleEffect(appeared ? 1.0 : 0.8)
                        .opacity(appeared ? 1.0 : 0.0)

                    Text("アクション不要")
                        .font(.title2.weight(.bold))
                        .foregroundColor(.white)
                        .opacity(appeared ? 1.0 : 0.0)

                    Text("この書類からアクション可能な\n予定は見つかりませんでした。")
                        .font(.subheadline)
                        .foregroundColor(.white.opacity(0.5))
                        .multilineTextAlignment(.center)
                        .opacity(appeared ? 1.0 : 0.0)
                }

                Spacer()

                // Scan again button
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
                .padding(.horizontal, 24)
                .padding(.bottom, 40)
                .opacity(appeared ? 1.0 : 0.0)
            }
        }
        .onAppear {
            withAnimation(.easeOut(duration: 0.6)) {
                appeared = true
            }
        }
    }
}
