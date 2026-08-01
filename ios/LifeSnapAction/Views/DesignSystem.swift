import SwiftUI
import UIKit

enum AppTheme {
    static let screen = Color(uiColor: .systemGroupedBackground)
    static let surface = Color(uiColor: .secondarySystemGroupedBackground)
    static let separator = Color(uiColor: .separator)
    static let accent = Color.blue
    static let warningSurface = Color(uiColor: .systemOrange).opacity(0.12)
    static let errorSurface = Color(uiColor: .systemRed).opacity(0.1)
}

struct PrimaryActionLabel: View {
    let title: String
    let systemImage: String

    var body: some View {
        Label(title, systemImage: systemImage)
            .font(.headline)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 52)
    }
}

struct DocumentThumbnail: View {
    let image: UIImage
    var maxWidth: CGFloat = 132
    var maxHeight: CGFloat = 172

    var body: some View {
        Image(uiImage: image)
            .resizable()
            .scaledToFit()
            .frame(maxWidth: maxWidth, maxHeight: maxHeight)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .stroke(AppTheme.separator.opacity(0.5), lineWidth: 0.5)
            }
            .accessibilityLabel("読み取った書類")
    }
}

struct DisclosureSummaryRow: View {
    let icon: String
    let title: String
    let value: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.body.weight(.medium))
                .foregroundStyle(AppTheme.accent)
                .frame(width: 24, height: 24)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.primary)

                Text(value)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
        }
    }
}

struct LabeledValueRow: View {
    let icon: String
    let label: String
    let value: String
    var valueStyle: AnyShapeStyle = AnyShapeStyle(Color.primary)

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: icon)
                .font(.body.weight(.medium))
                .foregroundStyle(AppTheme.accent)
                .frame(width: 24)
                .accessibilityHidden(true)

            Text(label)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .frame(width: 64, alignment: .leading)

            Text(value)
                .font(.body)
                .foregroundStyle(valueStyle)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 14)
    }
}

extension View {
    func appSectionStyle() -> some View {
        padding(16)
            .background(AppTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}
