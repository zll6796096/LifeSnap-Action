import SwiftUI
import PhotosUI

// MARK: - Capture View

/// Camera/photo picker screen — the app's home screen.
struct CaptureView: View {
    @Bindable var viewModel: CaptureViewModel
    let onImageSelected: (UIImage) -> Void

    @State private var selectedItem: PhotosPickerItem?

    var body: some View {
        ZStack {
            AppTheme.screen
                .ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("書類から予定を追加")
                            .font(.largeTitle.bold())
                            .foregroundStyle(.primary)
                            .fixedSize(horizontal: false, vertical: true)

                        Text("撮影または写真を選び、内容を確認してからカレンダーに追加します")
                            .font(.body)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    Image(systemName: "doc.viewfinder")
                        .font(.system(size: 62, weight: .regular))
                        .foregroundStyle(AppTheme.accent)
                        .frame(maxWidth: .infinity)
                        .frame(height: 150)
                        .background(AppTheme.surface)
                        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                        .accessibilityHidden(true)

                    VStack(spacing: 12) {
                        Button {
                            viewModel.showCamera = true
                        } label: {
                            PrimaryActionLabel(title: "カメラで撮影", systemImage: "camera.fill")
                        }
                        .buttonStyle(.borderedProminent)
                        .buttonBorderShape(.roundedRectangle(radius: 14))
                        .tint(AppTheme.accent)

                        PhotosPicker(selection: $selectedItem, matching: .images) {
                            PrimaryActionLabel(title: "写真から選ぶ", systemImage: "photo.on.rectangle")
                        }
                        .buttonStyle(.bordered)
                        .buttonBorderShape(.roundedRectangle(radius: 14))
                        .tint(AppTheme.accent)
                    }

                    privacyDisclosure
                }
                .padding(.horizontal, 20)
                .padding(.top, 28)
                .padding(.bottom, 32)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
            }
        }
        .fullScreenCover(isPresented: $viewModel.showCamera) {
            CameraView { image in
                viewModel.showCamera = false
                onImageSelected(image)
            }
            .ignoresSafeArea()
        }
        .onChange(of: selectedItem) { _, newItem in
            Task {
                await viewModel.loadImage(from: newItem)
                if let image = viewModel.selectedImage {
                    onImageSelected(image)
                    selectedItem = nil
                }
            }
        }
    }

    private var privacyDisclosure: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("画像を送信する前に、送信先とデータ利用に関する確認画面を毎回表示します。")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            Link(destination: APIClient.privacyPolicyURL) {
                Text("プライバシーポリシー")
                    .font(.footnote.weight(.medium))
            }
            .accessibilityLabel("プライバシーポリシー")
        }
    }
}

// MARK: - Camera View (UIKit Bridge)

struct CameraView: UIViewControllerRepresentable {
    let onCapture: (UIImage) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(onCapture: onCapture)
    }

    class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onCapture: (UIImage) -> Void

        init(onCapture: @escaping (UIImage) -> Void) {
            self.onCapture = onCapture
        }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            if let image = info[.originalImage] as? UIImage {
                onCapture(image)
            }
            picker.dismiss(animated: true)
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            picker.dismiss(animated: true)
        }
    }
}

// MARK: - Color Extension

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 6:
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8:
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (255, 0, 0, 0)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}
