import SwiftUI

enum ConsentCopy {
    static let title = "画像の送信を確認"
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

    @State private var showsDetails = false

    var body: some View {
        ZStack {
            AppTheme.screen
                .ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    header
                    imagePreview
                    summary
                    detailedDisclosure
                    privacyLink
                }
                .padding(.horizontal, 20)
                .padding(.top, 24)
                .padding(.bottom, 24)
                .frame(maxWidth: 680)
                .frame(maxWidth: .infinity)
            }
        }
        .safeAreaInset(edge: .bottom) {
            actions
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: "hand.raised.fill")
                .font(.title2.weight(.semibold))
                .foregroundStyle(AppTheme.accent)
                .accessibilityHidden(true)

            Text(ConsentCopy.title)
                .font(.largeTitle.bold())
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)

            Text("この確認は、画像を送信するたびに表示されます。")
                .font(.body)
                .foregroundStyle(.secondary)
        }
    }

    private var imagePreview: some View {
        Image(uiImage: image)
            .resizable()
            .scaledToFit()
            .frame(maxWidth: .infinity)
            .frame(maxHeight: 210)
            .background(AppTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(AppTheme.separator.opacity(0.5), lineWidth: 0.5)
            }
            .accessibilityLabel("送信前の書類画像プレビュー")
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("送信内容")
                .font(.headline)

            DisclosureSummaryRow(
                icon: "doc.text.magnifyingglass",
                title: "目的",
                value: "予定・タスク情報の読み取り"
            )

            Divider()

            DisclosureSummaryRow(
                icon: "arrow.up.forward.app",
                title: "送信先",
                value: "LifeSnap と Google Gemini"
            )

            Divider()

            DisclosureSummaryRow(
                icon: "person.text.rectangle",
                title: "含まれる可能性",
                value: "氏名、住所、日付、金額など"
            )

            Divider()

            DisclosureSummaryRow(
                icon: "externaldrive.badge.xmark",
                title: "保存",
                value: "LifeSnap は画像や抽出内容を永続保存しません"
            )
        }
        .appSectionStyle()
    }

    private var detailedDisclosure: some View {
        DisclosureGroup("データの取り扱い詳細", isExpanded: $showsDetails) {
            Text(ConsentCopy.disclosureBody)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .lineSpacing(3)
                .padding(.top, 12)
                .fixedSize(horizontal: false, vertical: true)
        }
        .font(.body.weight(.medium))
        .tint(AppTheme.accent)
        .appSectionStyle()
    }

    private var privacyLink: some View {
        Link(destination: APIClient.privacyPolicyURL) {
            Label(ConsentCopy.privacyLinkTitle, systemImage: "lock.text")
                .font(.footnote.weight(.medium))
        }
        .accessibilityIdentifier("privacyPolicyLink")
    }

    private var actions: some View {
        VStack(spacing: 8) {
            Button(action: onAgree) {
                PrimaryActionLabel(
                    title: purpose.primaryButtonTitle,
                    systemImage: "checkmark.shield"
                )
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.roundedRectangle(radius: 14))
            .tint(AppTheme.accent)
            .accessibilityIdentifier("agreeToAnalyzeButton")

            Button(ConsentCopy.cancelButtonTitle, action: onCancel)
                .font(.body.weight(.medium))
                .frame(maxWidth: .infinity)
                .frame(minHeight: 44)
                .accessibilityIdentifier("cancelConsentButton")
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 8)
        .background(.bar)
    }
}
