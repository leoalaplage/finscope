import SwiftUI

/// The fiche.
///
/// Its order is an argument, not a layout: who the company is, what it costs,
/// how FinScope scores it and on how much data, the four figures that matter,
/// one chart big enough to read, and then doors to the detail. Everything past
/// the chart is a drill-down — the page never becomes the twenty-KPI grid the
/// web fiche can afford and a phone cannot.
struct StockDetailView: View {
    @Bindable var viewModel: StockDetailViewModel
    @Environment(AppRouter.self) private var router

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: Theme.Spacing.xl) {
                header
                if let error = viewModel.summary.error, viewModel.summary.value != nil {
                    ErrorBanner(error: error) { await viewModel.refresh() }
                }
                scoreSection
                keyMetricsSection
                chartSection
                sectionsList
                provenanceSection
            }
            .padding(.horizontal, Theme.Spacing.lg)
            .padding(.vertical, Theme.Spacing.lg)
        }
        .background(Theme.Color.background)
        .navigationTitle(viewModel.company?.ticker ?? viewModel.ticker)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    viewModel.toggleWatchlist()
                } label: {
                    Image(systemName: viewModel.isInWatchlist ? "star.fill" : "star")
                }
                .tint(Theme.Color.accent)
                .accessibilityLabel(
                    viewModel.isInWatchlist ? "Remove from watchlist" : "Add to watchlist"
                )
            }
        }
        .refreshable { await viewModel.refresh() }
        .task { await viewModel.load() }
    }

    // MARK: - Header

    @ViewBuilder
    private var header: some View {
        switch viewModel.summary {
        case .idle, .loading:
            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                Shimmer(height: Theme.Size.skeletonHeadline).frame(width: Theme.Size.skeletonWidthLong)
                Shimmer(height: Theme.Size.skeletonCaption).frame(width: Theme.Size.skeletonWidthMedium)
                Shimmer(height: Theme.Size.skeletonHeadline).frame(width: Theme.Size.skeletonWidthMedium)
            }
        case .failed(nil, _, let error):
            ErrorView(error: error) { await viewModel.refresh() }
        case .loaded(let summary, let freshness), .refreshing(let summary, let freshness):
            headerContent(summary, freshness)
        case .failed(.some(let summary), let freshness, _):
            headerContent(summary, freshness ?? .unknown)
        }
    }

    private func headerContent(_ summary: CompanySummary, _ freshness: Freshness) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text(summary.company.name)
                .font(Theme.Typography.title)
                .foregroundStyle(Theme.Color.textPrimary)

            HStack(spacing: Theme.Spacing.sm) {
                Text(summary.company.ticker)
                    .font(Theme.Typography.mono(.footnote, weight: .medium))
                if let exchange = summary.company.exchange {
                    Text(verbatim: "·")
                    Text(exchange).font(Theme.Typography.footnote)
                }
                if let business = summary.company.businessTypeLabel, summary.company.isFinancial {
                    Text(verbatim: "·")
                    Text(business).font(Theme.Typography.footnote)
                }
            }
            .foregroundStyle(Theme.Color.textSecondary)

            if let price = summary.price {
                HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.md) {
                    Text(Formatter.preciseCurrency(price.value, code: price.currency))
                        .font(Theme.Typography.hero)
                        .foregroundStyle(Theme.Color.textPrimary)
                        .contentTransition(.numericText())
                    ChangeLabel(
                        changePercent: price.changePercent,
                        font: Theme.Typography.mono(.title3, weight: .semibold)
                    )
                }
                .padding(.top, Theme.Spacing.xs)

                // A price without its date is the one figure that can silently
                // become a lie, so the date is never optional here.
                Text("\(price.kind ?? "Close") · \(Formatter.day(price.asOf))")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Color.textTertiary)
            }

            FreshnessLabel(
                freshness: Freshness(
                    asOf: summary.period?.end,
                    retrievedAt: freshness.retrievedAt,
                    dataVersion: freshness.dataVersion,
                    isFromCache: freshness.isFromCache
                ),
                prefix: summary.period?.label
            )
            .padding(.top, Theme.Spacing.xs)
        }
    }

    // MARK: - Score

    @ViewBuilder
    private var scoreSection: some View {
        if let summary = viewModel.summary.value, let score = summary.score {
            ScoreCard(summary: score) {
                router.push(.score(ticker: viewModel.ticker))
            }
        } else if viewModel.summary.isBusy {
            Card { Shimmer(height: 96) }
        }
    }

    // MARK: - Key metrics

    @ViewBuilder
    private var keyMetricsSection: some View {
        if let summary = viewModel.summary.value, !summary.keyMetrics.isEmpty {
            VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                SectionHeader("Key figures")
                Card {
                    // Four, never twenty. Two rows of two on a phone; the rest
                    // of the metrics live behind the sections below.
                    let columns = [
                        GridItem(.flexible(), spacing: Theme.Spacing.lg, alignment: .topLeading),
                        GridItem(.flexible(), spacing: Theme.Spacing.lg, alignment: .topLeading),
                    ]
                    LazyVGrid(columns: columns, alignment: .leading, spacing: Theme.Spacing.xl) {
                        ForEach(summary.keyMetrics.prefix(4)) { metric in
                            MetricTile(metric: metric)
                        }
                    }
                }
            }
        }
    }

    // MARK: - Chart

    @ViewBuilder
    private var chartSection: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            SectionHeader(title: "Fundamentals") {
                if !viewModel.chartableSeries.isEmpty {
                    metricPicker
                }
            }

            Card {
                if let series = viewModel.selectedSeries {
                    FundamentalChart(
                        series: series,
                        range: $viewModel.range,
                        availableFrequencies: viewModel.availableFrequencies,
                        frequency: $viewModel.frequency,
                        isRefreshing: viewModel.fundamentals.isBusy
                    )
                } else if let error = viewModel.fundamentals.error {
                    ErrorView(error: error) { await viewModel.refresh() }
                } else {
                    Shimmer(height: Theme.Size.chart, cornerRadius: Theme.Radius.sm)
                }
            }
        }
    }

    private var metricPicker: some View {
        Menu {
            ForEach(viewModel.chartableSeries) { series in
                Button {
                    viewModel.selectedMetric = series.metric
                } label: {
                    // A metric with nothing behind it is still listed, marked,
                    // so the picker is a description of the company rather
                    // than a list that quietly omits its gaps.
                    Label(
                        series.isAvailable ? series.label : "\(series.label) — not published",
                        systemImage: series.metric == viewModel.selectedMetric ? "checkmark" : ""
                    )
                }
                .disabled(!series.isAvailable)
            }
        } label: {
            HStack(spacing: Theme.Spacing.xs) {
                Text(viewModel.selectedSeries?.label ?? "Metric")
                    .font(Theme.Typography.footnote.weight(.medium))
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 9, weight: .bold))
            }
            .foregroundStyle(Theme.Color.accent)
            .textCase(nil)
        }
        .accessibilityLabel("Choose the metric to chart")
    }

    // MARK: - Sections

    private var sectionsList: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            SectionHeader("Detail")
            Card(padding: 0) {
                VStack(spacing: 0) {
                    ForEach(Array(FundamentalSection.allCases.enumerated()), id: \.element) { index, section in
                        DisclosureRow {
                            router.push(.section(ticker: viewModel.ticker, section: section))
                        } label: {
                            Label(section.label, systemImage: section.systemImage)
                                .font(Theme.Typography.body)
                                .foregroundStyle(Theme.Color.textPrimary)
                        }
                        .padding(Theme.Spacing.lg)
                        if index < FundamentalSection.allCases.count - 1 {
                            Divider().padding(.leading, Theme.Spacing.lg)
                        }
                    }
                }
            }
        }
    }

    // MARK: - Provenance

    /// Where the figures came from and what FinScope flagged about them.
    ///
    /// Deliberately last and deliberately present. Warnings like "every
    /// derived quarter is marked calculated" are the difference between a
    /// number and a citation, and they belong on the page rather than in a
    /// methodology document nobody opens.
    @ViewBuilder
    private var provenanceSection: some View {
        if let summary = viewModel.summary.value {
            VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                SectionHeader("Sources")
                Card {
                    VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                        if let regulatory = summary.company.regulatoryId {
                            LabeledContent("Filer", value: regulatory)
                                .font(Theme.Typography.footnote)
                        }
                        if let score = summary.score {
                            LabeledContent("Score version", value: score.scoreVersion)
                                .font(Theme.Typography.footnote)
                            LabeledContent("Universe", value: score.universeVersion)
                                .font(Theme.Typography.footnote)
                        }
                        if let version = viewModel.summary.freshness?.dataVersion {
                            LabeledContent("Data version", value: version)
                                .font(Theme.Typography.footnote)
                        }
                        if !summary.warnings.isEmpty {
                            Divider()
                            ForEach(summary.warnings, id: \.self) { warning in
                                Label(warning, systemImage: "info.circle")
                                    .font(Theme.Typography.caption)
                                    .foregroundStyle(Theme.Color.textSecondary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                    .foregroundStyle(Theme.Color.textSecondary)
                }
            }
        }
    }
}

#if DEBUG
#Preview("Fiche · Apple") {
    let dependencies = AppDependencies.preview()
    return NavigationStack {
        StockDetailView(
            viewModel: StockDetailViewModel(
                ticker: "AAPL",
                repository: dependencies.companies,
                watchlist: dependencies.watchlist
            )
        )
    }
    .environment(AppRouter())
}

#Preview("Fiche · an exchange, mostly unavailable") {
    let dependencies = AppDependencies.preview()
    return NavigationStack {
        StockDetailView(
            viewModel: StockDetailViewModel(
                ticker: "CME",
                repository: dependencies.companies,
                watchlist: dependencies.watchlist
            )
        )
    }
    .environment(AppRouter())
}

#Preview("Fiche · dark") {
    let dependencies = AppDependencies.preview()
    return NavigationStack {
        StockDetailView(
            viewModel: StockDetailViewModel(
                ticker: "NVDA",
                repository: dependencies.companies,
                watchlist: dependencies.watchlist
            )
        )
    }
    .environment(AppRouter())
    .preferredColorScheme(.dark)
}
#endif
