import SwiftUI

/// A figure with its label, and — when there is no figure — the reason there
/// isn't one, in the same space the figure would have occupied.
///
/// This is the component that enforces the product's first rule. There is no
/// initialiser that takes a bare `Double?`: a caller must hand over a
/// `MetricValue`, which cannot be absent without carrying a reason.
struct MetricTile: View {
    let metric: NamedMetric
    var alignment: HorizontalAlignment = .leading

    @ScaledMetric(relativeTo: .caption) private var reasonSpacing: CGFloat = 2

    var body: some View {
        VStack(alignment: alignment, spacing: Theme.Spacing.xs) {
            Text(metric.label)
                .font(Theme.Typography.footnote)
                .foregroundStyle(Theme.Color.textSecondary)
                .lineLimit(2)

            Text(Formatter.value(metric.metric))
                .font(Theme.Typography.mono(.title3, weight: .medium))
                .foregroundStyle(
                    metric.metric.isAvailable ? Theme.Color.textPrimary : Theme.Color.textTertiary
                )
                .contentTransition(.numericText())
                .lineLimit(1)
                .minimumScaleFactor(0.7)

            if let reason = metric.metric.reason {
                Text(reason)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Color.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, reasonSpacing)
            } else if let basis = metric.metric.basis {
                Label(basis, systemImage: "info.circle")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Color.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, reasonSpacing)
            }
        }
        .frame(maxWidth: .infinity, alignment: alignment == .leading ? .leading : .center)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(metric.metric.accessibilityDescription(label: metric.label))
    }
}

/// A label and a figure on one line, for lists of many metrics.
struct MetricRow: View {
    let metric: NamedMetric

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.md) {
                Text(metric.label)
                    .font(Theme.Typography.body)
                    .foregroundStyle(Theme.Color.textPrimary)
                Spacer(minLength: Theme.Spacing.sm)
                Text(Formatter.value(metric.metric))
                    .font(Theme.Typography.mono(.body, weight: .medium))
                    .foregroundStyle(
                        metric.metric.isAvailable ? Theme.Color.textPrimary : Theme.Color.textTertiary
                    )
            }
            if let reason = metric.metric.reason {
                Text(reason)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Color.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            } else if let detail = metric.detail {
                Text(detail)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Color.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(metric.metric.accessibilityDescription(label: metric.label))
    }
}

/// A signed move, coloured by direction. Grey at zero.
struct ChangeLabel: View {
    let changePercent: Double?
    var font: Font = Theme.Typography.mono(.callout, weight: .medium)

    var body: some View {
        Group {
            if let changePercent {
                Text(Formatter.signedPercentagePoints(changePercent))
                    .contentTransition(.numericText())
            } else {
                Text(verbatim: Formatter.missing)
            }
        }
        .font(font)
        .foregroundStyle(Theme.Color.direction(changePercent))
        .accessibilityLabel(
            changePercent.map { "\($0 < 0 ? "down" : "up") \(Formatter.percentagePoints(abs($0), fractionDigits: 2)) today" }
                ?? "No change available"
        )
    }
}

/// When the figures on screen are from, and whether they came off the device.
///
/// Small, quiet, and never omitted. A cached figure with a date is honest; the
/// same figure without one is a claim about now.
struct FreshnessLabel: View {
    let freshness: Freshness
    var prefix: String?

    var body: some View {
        if let text {
            Label {
                Text(text)
            } icon: {
                Image(systemName: freshness.isFromCache ? "internaldrive" : "clock")
            }
            .font(Theme.Typography.caption)
            .foregroundStyle(Theme.Color.textTertiary)
            .labelStyle(.titleAndIcon)
        }
    }

    private var text: String? {
        var parts: [String] = []
        if let prefix { parts.append(prefix) }
        if let asOf = freshness.asOf { parts.append("as of \(Formatter.day(asOf))") }
        if let retrievedAt = freshness.retrievedAt {
            parts.append(freshness.isFromCache
                ? "saved \(Formatter.relative(retrievedAt))"
                : "read \(Formatter.relative(retrievedAt))")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

#Preview("Metrics") {
    ScrollView {
        VStack(alignment: .leading, spacing: Theme.Spacing.xl) {
            HStack(alignment: .top, spacing: Theme.Spacing.lg) {
                MetricTile(metric: NamedMetric(
                    key: "roic", label: "ROIC", detail: nil,
                    metric: .known(90.93, unit: .percent)
                ))
                MetricTile(metric: NamedMetric(
                    key: "netDebt", label: "Net debt", detail: nil,
                    metric: .known(42_803_000_000, unit: .currency, currency: "USD")
                ))
            }
            MetricTile(metric: NamedMetric(
                key: "roic", label: "Return on invested capital", detail: nil,
                metric: .unavailable(
                    "Not comparable for an exchange: borrowing is an input to this business, not a burden on it.",
                    unit: .percent
                )
            ))
            Card {
                VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
                    MetricRow(metric: NamedMetric(
                        key: "revenue", label: "Revenue", detail: "Trailing twelve months",
                        metric: .known(466_823_000_000, status: .reported, unit: .currency, currency: "USD")
                    ))
                    Divider()
                    MetricRow(metric: NamedMetric(
                        key: "fcf", label: "Free cash flow margin", detail: nil,
                        metric: .unavailable("The company does not publish the cash-flow figures this is built from.", unit: .percent)
                    ))
                }
            }
            HStack(spacing: Theme.Spacing.lg) {
                ChangeLabel(changePercent: 1.0001)
                ChangeLabel(changePercent: -2.44)
                ChangeLabel(changePercent: nil)
            }
            FreshnessLabel(
                freshness: Freshness(
                    asOf: .now.addingTimeInterval(-86_400 * 60),
                    retrievedAt: .now.addingTimeInterval(-7_200),
                    dataVersion: "v23",
                    isFromCache: true
                )
            )
        }
        .padding()
    }
    .background(Theme.Color.background)
}
