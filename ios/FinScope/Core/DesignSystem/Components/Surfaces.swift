import SwiftUI

/// The base container, on the grouped-form surface iOS uses for content.
struct Card<Content: View>: View {
    var padding: CGFloat = Theme.Spacing.lg
    var elevated: Bool = false
    @ViewBuilder var content: Content

    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(elevated ? Theme.Color.surfaceElevated : Theme.Color.surface)
            .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
    }
}

/// A quiet section title with an optional accessory on the right.
struct SectionHeader<Accessory: View>: View {
    let title: String
    @ViewBuilder var accessory: Accessory

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.sm) {
            Text(title)
                .font(Theme.Typography.footnote)
                .foregroundStyle(Theme.Color.textSecondary)
                .textCase(.uppercase)
                .tracking(0.6)
            Spacer(minLength: Theme.Spacing.sm)
            accessory
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

extension SectionHeader where Accessory == EmptyView {
    init(_ title: String) {
        self.init(title: title) { EmptyView() }
    }
}

/// A row that opens something else. The chevron is the affordance; the row is
/// the target, at full width.
struct DisclosureRow<Label: View>: View {
    let action: () -> Void
    @ViewBuilder var label: Label

    var body: some View {
        Button(action: action) {
            HStack(spacing: Theme.Spacing.md) {
                label
                Spacer(minLength: Theme.Spacing.sm)
                Image(systemName: "chevron.right")
                    .font(Theme.Typography.footnote.weight(.semibold))
                    .foregroundStyle(Theme.Color.textTertiary)
                    .accessibilityHidden(true)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// A dismissible chip, used for active filters.
struct Chip: View {
    let label: String
    var onRemove: (() -> Void)?

    var body: some View {
        HStack(spacing: Theme.Spacing.xs) {
            Text(label)
                .font(Theme.Typography.footnote.weight(.medium))
            if onRemove != nil {
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .bold))
                    .accessibilityHidden(true)
            }
        }
        .foregroundStyle(Theme.Color.accent)
        .padding(.horizontal, Theme.Spacing.group)
        .padding(.vertical, Theme.Spacing.xs + 2)
        .background(Theme.Color.accent.opacity(Theme.Opacity.chipFill))
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.chip, style: .continuous))
        .contentShape(Rectangle())
        .onTapGesture { onRemove?() }
        .accessibilityLabel(onRemove == nil ? label : "\(label). Remove filter")
        .accessibilityAddTraits(onRemove == nil ? [] : .isButton)
    }
}

#Preview("Surfaces") {
    ScrollView {
        VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
            SectionHeader("Watchlist")
            Card {
                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    Text(verbatim: "Apple Inc.").font(Theme.Typography.headline)
                    Text(verbatim: "AAPL · NASDAQ")
                        .font(Theme.Typography.footnote)
                        .foregroundStyle(Theme.Color.textSecondary)
                }
            }
            HStack(spacing: Theme.Spacing.sm) {
                Chip(label: "Score ≥ 60") {}
                Chip(label: "A+")
                Chip(label: "ROIC ≥ 20%") {}
            }
            Card {
                DisclosureRow(action: {}) {
                    Text(verbatim: "Profitability").font(Theme.Typography.body)
                }
            }
        }
        .padding()
    }
    .background(Theme.Color.background)
}
