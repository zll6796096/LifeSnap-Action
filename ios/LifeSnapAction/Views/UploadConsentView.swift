import SwiftUI

enum ConsentCopy {
    static let title = "AI解析の前に確認してください"
    static let cancelButtonTitle = "キャンセル"
    static let privacyLinkTitle = "プライバシーポリシー"
    static let disclosureBody = """
    この書類画像は、予定・タスク情報を抽出する目的で LifeSnap の Google Cloud Run バックエンドと第三者AIサービス Google Gemini（Google LLC）へ送信されます。

    画像には、氏名、住所、日付、金額、機関名、予約情報などの個人情報が含まれる場合があります。

    LifeSnap はリクエスト処理中にメモリ上で画像を扱い、画像、base64、OCR内容、抽出結果をデータベース・オブジェクトストレージ・ファイルへ永続保存しません。

    Google Gemini Paid Service では、入力と出力は Google 製品の改善に使用されません。ただし、安全性、セキュリティ、不正利用防止、法的義務のために限定された期間ログ処理が行われる場合があり、処理は国や地域をまたぐ可能性があります。

    同意しない場合はキャンセルできます。キャンセルすると画像は送信されず、AI解析もカレンダー追加も行われません。
    """
}

struct UploadConsentView: View {
    let image: UIImage
    let purpose: ConsentPurpose
    let onAgree: () -> Void
    let onCancel: () -> Void

    var body: some View {
        ZStack {
            Color(hex: "0F0F1A")
                .ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    header
                    imagePreview
                    disclosure
                    actions
                }
                .padding(.horizontal, 24)
                .padding(.top, 28)
                .padding(.bottom, 34)
                .frame(maxWidth: 680)
                .frame(maxWidth: .infinity)
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: "shield.lefthalf.filled")
                .font(.system(size: 34, weight: .semibold))
                .foregroundColor(Color(hex: "48C6EF"))

            Text(ConsentCopy.title)
                .font(.system(size: 26, weight: .bold, design: .rounded))
                .foregroundColor(.white)
                .fixedSize(horizontal: false, vertical: true)

            Text("この確認は、画像を送信するたびに表示されます。")
                .font(.subheadline)
                .foregroundColor(.white.opacity(0.64))
        }
    }

    private var imagePreview: some View {
        Image(uiImage: image)
            .resizable()
            .scaledToFit()
            .frame(maxWidth: .infinity)
            .frame(maxHeight: 260)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Color.white.opacity(0.16), lineWidth: 1)
            )
            .accessibilityLabel("送信前の書類画像プレビュー")
    }

    private var disclosure: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(ConsentCopy.disclosureBody)
                .font(.body)
                .lineSpacing(4)
                .foregroundColor(.white.opacity(0.82))
                .fixedSize(horizontal: false, vertical: true)

            Link(destination: APIClient.privacyPolicyURL) {
                HStack(spacing: 8) {
                    Image(systemName: "lock.text")
                    Text(ConsentCopy.privacyLinkTitle)
                        .underline()
                }
                .font(.subheadline.weight(.semibold))
                .foregroundColor(Color(hex: "48C6EF"))
            }
            .accessibilityIdentifier("privacyPolicyLink")
        }
    }

    private var actions: some View {
        VStack(spacing: 12) {
            Button {
                onAgree()
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "sparkles")
                    Text(purpose.primaryButtonTitle)
                        .fontWeight(.semibold)
                }
                .font(.headline)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 17)
                .background(Color(hex: "6C63FF"))
                .foregroundColor(.white)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .accessibilityIdentifier("agreeToAnalyzeButton")

            Button {
                onCancel()
            } label: {
                Text(ConsentCopy.cancelButtonTitle)
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .foregroundColor(.white.opacity(0.78))
                    .background(Color.white.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .accessibilityIdentifier("cancelConsentButton")
        }
    }
}
