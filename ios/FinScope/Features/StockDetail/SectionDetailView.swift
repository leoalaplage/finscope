import SwiftUI

/// One section of the fiche — Growth, Profitability, Cash Flow, Balance Sheet,
/// Valuation — as a focused screen.
///
/// A few metrics, each with its own chart and its latest value. This is where
/// the twenty metrics the main fiche refuses to grid actually live: three at a
/// time, each large enough to read.
struct SectionDetailView: View {
    let section: FundamentalSection
    @Bindable var viewModel: StockDetailViewModel

    /// Ranges are per-section rather than shared with the main fiche: looking
    /// at a decade of revenue says nothing about wanting a decade of margins.
    @State private var range: SeriesRange = .tenYears

    private var series: [FundamentalSeries] {
        guard let bundle = viewModel.fundamentals.value else { return [] }
        return section.metrics.compactMap { bundle.series(for: $0) }
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: Theme.Spacing.xl) {
                if viewModel.fundamentals.isInitialLoad {
                    ForEach(0..<2, id: \.self) { _ in
                        Card { Shimmer(height: Theme.Size.chart, cornerRadius: Theme.Radius.sm) }
                    }
                } else if let error = viewModel.fundamentals.error, series.isEmpty {
                    ErrorView(error: error) { await viewModel.refresh() }
                } else if series.isEmpty {
                    EmptyState(
                        systemImage: section.systemImage,
                        title: "Nothing to show",
                        message: "FinScope holds none of this section's figures for \(viewModel.ticker)."
                    )
                } else {
                    ForEach(series) { item in
                        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                            header(for: item)
                            Card {
                                FundamentalChart(
                                    series: item,
                                    range: $range,
                                    availableFrequencies: viewModel.availableFrequencies,
                                    frequency: $viewModel.frequency,
                                    isRefreshing: viewModel.fundamentals.isBusy
                                )
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, Theme.Spacing.lg)
            .padding(.vertical, Theme.Spacing.lg)
        }
        .background(Theme.Color.background)
        .navigationTitle(section.label)
        .navigationBarTitleDisplayMode(.inline)
        .task { await viewModel.load() }
    }

    /// The metric's name, its latest figure, and the move since the period
    /// before it — a comparison between two figures already received, which is
    /// the only arithmetic this screen is allowed to do.
    private func header(for item: FundamentalSeries) -> some View {
        let points = item.plottablePoints
        let latest = points.last
        let previous = points.dropLast().last
        let change: Double? = {
            guard let current = latest?.value, let prior = previous?.value, prior != 0 else { return nil }
            return (current - prior) / abs(prior) * 100
        }()

        return VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            HStack(alignment: .firstTextBaseline) {
                Text(item.label)
                    .font(Theme.Typography.headline)
                    .foregroundStyle(Theme.Color.textPrimary)
                Spacer(minLength: Theme.Spacing.sm)
                if let value = latest?.value {
                    Text(Formatter.number(value, unit: item.unit, currency: item.currency))
                        .font(Theme.Typography.mono(.body, weight: .medium))
                        .foregroundStyle(Theme.Color.textPrimary)
                }
            }
            if let change, let previous {
                HStack(spacing: Theme.Spacing.xs) {
                    ChangeLabel(changePercent: change, font: Theme.Typography.mono(.caption, weight: .medium))
                    Text("vs \(previous.label)")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Color.textTertiary)
                }
            } else if !item.isAvailable, let reason = item.unavailableReason {
                Text(reason)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Color.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

#if DEBUG
#Preview("Section · Cash Flow") {
    let dependencies = AppDependencies.preview()
    return NavigationStack {
        SectionDetailView(
            section: .cashFlow,
            viewModel: StockDetailViewModel(
                ticker: "AAPL",
                repository: dependencies.companies,
                watchlist: dependencies.watchlist
            )
        )
    }
}
#endif
