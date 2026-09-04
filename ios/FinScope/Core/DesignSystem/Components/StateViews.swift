import SwiftUI

/// A loading block. One slow sweep, and none at all when the reader has asked
/// for less motion.
struct Shimmer: View {
    var height: CGFloat = Theme.Size.skeletonLine
    var cornerRadius: CGFloat = Theme.Radius.xs

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase: CGFloat = -1

    var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(Theme.Color.fill)
            .frame(height: height)
            .overlay {
                if !reduceMotion {
                    GeometryReader { geometry in
                        LinearGradient(
                            colors: [
                                .clear,
                                Theme.Color.surface.opacity(Theme.Opacity.shimmer),
                                .clear,
                            ],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                        .frame(width: geometry.size.width * 0.5)
                        .offset(x: phase * geometry.size.width * 1.5)
                    }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .task(id: reduceMotion) {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: Theme.Duration.shimmer).repeatForever(autoreverses: true)) {
                    phase = 1
                }
            }
            .accessibilityHidden(true)
    }
}

/// The skeleton of a company row.
struct CompanyRowPlaceholder: View {
    var body: some View {
        HStack(spacing: Theme.Spacing.md) {
            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                Shimmer().frame(width: Theme.Size.skeletonWidthShort)
                Shimmer(height: Theme.Size.skeletonCaption).frame(width: Theme.Size.skeletonWidthLong)
            }
            Spacer(minLength: Theme.Spacing.md)
            Shimmer().frame(width: Theme.Size.skeletonWidthShort)
        }
        .padding(.vertical, Theme.Spacing.sm)
        .accessibilityHidden(true)
    }
}

/// A failure, said plainly, with a retry only where retrying is honest.
struct ErrorView: View {
    let error: FinScopeError
    var retry: (() async -> Void)?

    var body: some View {
        VStack(spacing: Theme.Spacing.lg) {
            Image(systemName: error.systemImage)
                .font(.system(.largeTitle))
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(Theme.Color.textSecondary)
                .accessibilityHidden(true)

            VStack(spacing: Theme.Spacing.sm) {
                Text(error.title)
                    .font(Theme.Typography.title)
                    .foregroundStyle(Theme.Color.textPrimary)
                Text(error.message)
                    .font(Theme.Typography.callout)
                    .foregroundStyle(Theme.Color.textSecondary)
            }
            .multilineTextAlignment(.center)

            if error.isRetryable, let retry {
                Button("Try again") { Task { await retry() } }
                    .buttonStyle(.bordered)
                    .tint(Theme.Color.accent)
            }
        }
        .padding(Theme.Spacing.xl)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
    }
}

/// A failure that must not take over the screen, because there are still
/// figures on it.
struct ErrorBanner: View {
    let error: FinScopeError
    var retry: (() async -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: Theme.Spacing.md) {
            Image(systemName: error.systemImage)
                .foregroundStyle(Theme.Color.negative)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Theme.Spacing.hairline) {
                Text(error.title)
                    .font(Theme.Typography.footnote.weight(.semibold))
                    .foregroundStyle(Theme.Color.textPrimary)
                Text(error.message)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Color.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: Theme.Spacing.sm)
            if error.isRetryable, let retry {
                Button("Retry") { Task { await retry() } }
                    .font(Theme.Typography.footnote.weight(.semibold))
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.Color.accent)
            }
        }
        .padding(Theme.Spacing.md)
        .background(Theme.Color.negative.opacity(Theme.Opacity.chipFill))
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// Nothing here, and what to do about it.
struct EmptyState: View {
    let systemImage: String
    let title: String
    let message: String
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: Theme.Spacing.lg) {
            Image(systemName: systemImage)
                .font(.system(.largeTitle))
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(Theme.Color.accent)
                .accessibilityHidden(true)

            VStack(spacing: Theme.Spacing.sm) {
                Text(title)
                    .font(Theme.Typography.title)
                    .foregroundStyle(Theme.Color.textPrimary)
                Text(message)
                    .font(Theme.Typography.callout)
                    .foregroundStyle(Theme.Color.textSecondary)
            }
            .multilineTextAlignment(.center)

            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .buttonStyle(.bordered)
                    .tint(Theme.Color.accent)
            }
        }
        .padding(Theme.Spacing.xl)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
    }
}

#Preview("States") {
    ScrollView {
        VStack(spacing: Theme.Spacing.xl) {
            VStack { CompanyRowPlaceholder(); CompanyRowPlaceholder() }
            ErrorBanner(error: .offline, retry: {})
            ErrorView(error: .building("AAPL"), retry: {})
            EmptyState(
                systemImage: "star",
                title: "No companies yet",
                message: "Search for a company and add it here to follow it.",
                actionTitle: "Search"
            ) {}
        }
        .padding()
    }
    .background(Theme.Color.background)
}
