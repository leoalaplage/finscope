import SwiftUI

/// The Quality Score, opened up.
///
/// The order is chosen so a reader cannot arrive at the number without passing
/// what qualifies it: the total and its coverage, then the pillars, then what
/// the engine actually liked and disliked, then — never folded away — the
/// metrics this company publishes nothing for, whose weight was redistributed
/// across the ones it does. A high score on thin data is the single most
/// misleading thing this screen could produce, so the thinness is on the page.
///
/// Nothing here is computed. iOS never scores a company.
struct ScoreDetailView: View {
    @Bindable var viewModel: StockDetailViewModel

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: Theme.Spacing.xl) {
                switch viewModel.score {
                case .idle, .loading:
                    Card { Shimmer(height: 140) }
                    Card { Shimmer(height: 180) }
                case .failed(nil, _, let error):
                    ErrorView(error: error) { await viewModel.refresh() }
                case .loaded(let score, _), .refreshing(let score, _):
                    content(score)
                case .failed(.some(let score), _, let error):
                    ErrorBanner(error: error) { await viewModel.refresh() }
                    content(score)
                }
            }
            .padding(.horizontal, Theme.Spacing.lg)
            .padding(.vertical, Theme.Spacing.lg)
        }
        .background(Theme.Color.background)
        .navigationTitle("Quality Score")
        .navigationBarTitleDisplayMode(.inline)
        .task { await viewModel.load() }
    }

    @ViewBuilder
    private func content(_ score: QualityScore) -> some View {
        ScoreCard(summary: score.summary)

        if score.summary.coverage < score.coverageFloor {
            coverageWarning(score)
        }

        pillars(score)

        if !score.alerts.isEmpty { alerts(score) }
        if !score.strengths.isEmpty || !score.weaknesses.isEmpty { highlights(score) }

        ranks(score)

        if !score.unavailableMetrics.isEmpty { unavailable(score) }

        methodology(score)
    }

    /// Below the floor the engine withholds a grade. Saying why, in place,
    /// beats leaving a reader to wonder what "NR" meant.
    private func coverageWarning(_ score: QualityScore) -> some View {
        Card {
            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                Label("Below the coverage floor", systemImage: "exclamationmark.triangle")
                    .font(Theme.Typography.footnote.weight(.semibold))
                    .foregroundStyle(Theme.Color.negative)
                Text(
                    "\(viewModel.ticker) publishes \(Formatter.coverage(score.summary.coverage)) of the scored metrics, "
                    + "below the \(Formatter.coverage(score.coverageFloor)) FinScope requires before it will grade a company. "
                    + "The pillar scores below are still what the published metrics earned."
                )
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Color.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func pillars(_ score: QualityScore) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            SectionHeader("Pillars")
            Card {
                VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
                    ForEach(ScorePillar.allCases) { pillar in
                        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                            PillarBar(pillar: pillar, score: score.summary.pillars[pillar] ?? nil)
                            Text(pillar.question)
                                .font(Theme.Typography.caption)
                                .foregroundStyle(Theme.Color.textTertiary)
                        }
                    }
                }
            }
        }
    }

    private func alerts(_ score: QualityScore) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            SectionHeader("Alerts")
            Card {
                VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                    ForEach(score.alerts, id: \.self) { alert in
                        Label(alert, systemImage: "exclamationmark.circle")
                            .font(Theme.Typography.footnote)
                            .foregroundStyle(Theme.Color.textPrimary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }

    private func highlights(_ score: QualityScore) -> some View {
        HStack(alignment: .top, spacing: Theme.Spacing.md) {
            highlightColumn("Strengths", score.strengths, tint: Theme.Color.positive)
            highlightColumn("Weaknesses", score.weaknesses, tint: Theme.Color.negative)
        }
    }

    private func highlightColumn(
        _ title: String,
        _ items: [ScoreHighlight],
        tint: Color
    ) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            SectionHeader(title)
            Card {
                VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                    if items.isEmpty {
                        Text(verbatim: Formatter.missing)
                            .foregroundStyle(Theme.Color.textTertiary)
                    }
                    ForEach(items) { item in
                        VStack(alignment: .leading, spacing: Theme.Spacing.hairline) {
                            Text(item.label)
                                .font(Theme.Typography.caption)
                                .foregroundStyle(Theme.Color.textPrimary)
                                .fixedSize(horizontal: false, vertical: true)
                            Text(Formatter.score(item.score))
                                .font(Theme.Typography.mono(.caption, weight: .semibold))
                                .foregroundStyle(tint)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func ranks(_ score: QualityScore) -> some View {
        if score.rank != nil || score.sectorRank != nil {
            Card {
                VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                    if let rank = score.rank {
                        LabeledContent("Rank", value: "\(rank) of \(score.summary.universeSize)")
                    }
                    if let sectorRank = score.sectorRank, let size = score.sectorSize,
                       let sector = score.sector {
                        LabeledContent("In \(sector)", value: "\(sectorRank) of \(size)")
                    }
                    if let valuation = score.valuationLabel {
                        LabeledContent("Valuation", value: valuation)
                    }
                }
                .font(Theme.Typography.footnote)
                .foregroundStyle(Theme.Color.textSecondary)
            }
        }
    }

    /// The metrics with no figure behind them.
    ///
    /// Expanded by default, not tucked into a disclosure. When the engine
    /// cannot score a metric it spreads that metric's weight over the rest,
    /// which raises the score — so the reader is owed the list of what was
    /// redistributed.
    private func unavailable(_ score: QualityScore) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            SectionHeader(title: "Not scored") {
                Text("\(score.unavailableMetrics.count) of \(score.metrics.count)")
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Color.textTertiary)
                    .textCase(nil)
            }
            Card {
                VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                    Text(
                        "These carry no published figure for \(viewModel.ticker). "
                        + "Their weight is spread across the metrics that do, which is why coverage sits beside the score."
                    )
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Color.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)

                    Divider()

                    ForEach(score.unavailableMetrics) { metric in
                        HStack(alignment: .firstTextBaseline) {
                            Text(metric.label)
                                .font(Theme.Typography.footnote)
                                .foregroundStyle(Theme.Color.textSecondary)
                            Spacer(minLength: Theme.Spacing.sm)
                            Text(metric.pillar.label)
                                .font(Theme.Typography.caption)
                                .foregroundStyle(Theme.Color.textTertiary)
                        }
                    }
                }
            }
        }
    }

    /// Every metric with its figure and its points, per pillar.
    private func methodology(_ score: QualityScore) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            SectionHeader("Every metric")
            ForEach(ScorePillar.allCases) { pillar in
                let metrics = score.metrics(in: pillar)
                if !metrics.isEmpty {
                    DisclosureGroup {
                        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                            ForEach(metrics) { metric in
                                scoredRow(metric)
                            }
                        }
                        .padding(.top, Theme.Spacing.sm)
                    } label: {
                        Text(pillar.label)
                            .font(Theme.Typography.headline)
                            .foregroundStyle(Theme.Color.textPrimary)
                    }
                    .tint(Theme.Color.accent)
                    .padding(Theme.Spacing.lg)
                    .background(Theme.Color.surface)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.md, style: .continuous))
                }
            }

            Text(
                "The score is relative: each metric is ranked against the covered universe "
                + "(\(score.summary.universeVersion)), then blended with an absolute anchor. "
                + "FinScope's server computes it; this app only displays it."
            )
            .font(Theme.Typography.caption)
            .foregroundStyle(Theme.Color.textTertiary)
            .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func scoredRow(_ metric: ScoredMetric) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.hairline) {
            HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.sm) {
                Text(metric.label)
                    .font(Theme.Typography.footnote)
                    .foregroundStyle(Theme.Color.textPrimary)
                Spacer(minLength: Theme.Spacing.sm)
                Text(metric.raw.map { Formatter.ratio($0) } ?? Formatter.missing)
                    .font(Theme.Typography.mono(.footnote))
                    .foregroundStyle(metric.raw == nil ? Theme.Color.textTertiary : Theme.Color.textSecondary)
                Text(Formatter.score(metric.score))
                    .font(Theme.Typography.mono(.footnote, weight: .semibold))
                    .foregroundStyle(Theme.Color.score(metric.score))
                    .frame(width: 32, alignment: .trailing)
            }
            if let reason = metric.unavailableReason {
                Text(reason)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Color.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            metric.raw == nil
                ? "\(metric.label): not scored. \(metric.unavailableReason ?? "")"
                : "\(metric.label): \(Formatter.ratio(metric.raw ?? 0)), scoring \(Formatter.score(metric.score))"
        )
    }
}

#if DEBUG
#Preview("Score · Apple") {
    let dependencies = AppDependencies.preview()
    return NavigationStack {
        ScoreDetailView(
            viewModel: StockDetailViewModel(
                ticker: "AAPL",
                repository: dependencies.companies,
                watchlist: dependencies.watchlist
            )
        )
    }
}

#Preview("Score · below the coverage floor") {
    let dependencies = AppDependencies.preview()
    return NavigationStack {
        ScoreDetailView(
            viewModel: StockDetailViewModel(
                ticker: "CME",
                repository: dependencies.companies,
                watchlist: dependencies.watchlist
            )
        )
    }
}
#endif
