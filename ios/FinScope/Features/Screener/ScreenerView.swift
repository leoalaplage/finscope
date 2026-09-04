import SwiftUI

/// The screener as a list, not a table.
///
/// A desktop screener is a grid you scan across; a phone cannot be, and
/// pretending otherwise produces a spreadsheet nobody can read. So each
/// company is a row with the two figures the current sort makes relevant —
/// sort by ROIC and ROIC is what you see — and everything else is a tap away.
struct ScreenerView: View {
    @Bindable var viewModel: ScreenerViewModel
    let onOpen: (String, String) -> Void

    var body: some View {
        List {
            if !viewModel.filters.chips.isEmpty {
                chipsSection
            }

            switch viewModel.page {
            case .idle, .loading:
                Section {
                    ForEach(0..<Theme.Count.loadingRows, id: \.self) { _ in CompanyRowPlaceholder() }
                }
            case .failed(nil, _, let error):
                Section {
                    ErrorView(error: error) { await viewModel.refresh() }
                }
                .listRowBackground(Color.clear)
            case .loaded(let page, let freshness), .refreshing(let page, let freshness):
                rowsSection(page, freshness, error: nil)
            case .failed(.some(let page), let freshness, let error):
                rowsSection(page, freshness ?? .unknown, error: error)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("QS Screener")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker("Sort by", selection: sortBinding) {
                        ForEach(ScreenerSort.allCases) { option in
                            Text(option.label).tag(option)
                        }
                    }
                } label: {
                    Image(systemName: "arrow.up.arrow.down")
                }
                .tint(Theme.Color.accent)
                .accessibilityLabel("Sort")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { viewModel.openFilters() } label: {
                    Image(systemName: viewModel.filters.isEmpty
                          ? "line.3.horizontal.decrease.circle"
                          : "line.3.horizontal.decrease.circle.fill")
                }
                .tint(Theme.Color.accent)
                .accessibilityLabel("Filters")
            }
        }
        .refreshable { await viewModel.refresh() }
        .task { await viewModel.load() }
        .sheet(isPresented: $viewModel.isShowingFilters) {
            FilterSheet(viewModel: viewModel)
        }
    }

    /// The two figures a row shows, dropping any the universe has nothing for.
    ///
    /// The sort names its preferred pair, but a column no company carries
    /// renders as a dash on every row — which looks like a bug and tells the
    /// reader nothing. Anything dropped is replaced by a metric that is
    /// actually populated.
    private func rowMetrics(for page: ScreenerPage) -> [ScreenerMetric] {
        let populated = ScreenerMetric.allCases.filter { metric in
            page.rows.contains { $0.metric(metric) != nil }
        }
        let preferred = viewModel.filters.sort.rowMetrics.filter(populated.contains)
        let filler = populated.filter { !preferred.contains($0) }
        return Array((preferred + filler).prefix(2))
    }

    private var sortBinding: Binding<ScreenerSort> {
        Binding(
            get: { viewModel.filters.sort },
            set: { viewModel.filters.sort = $0 }
        )
    }

    private var chipsSection: some View {
        Section {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Theme.Spacing.sm) {
                    ForEach(viewModel.filters.chips) { chip in
                        Chip(label: chip.label) { viewModel.remove(chip: chip) }
                    }
                }
                .padding(.vertical, Theme.Spacing.xs)
            }
            .listRowInsets(EdgeInsets(top: 0, leading: Theme.Spacing.lg, bottom: 0, trailing: 0))
        }
        .listRowBackground(Color.clear)
    }

    @ViewBuilder
    private func rowsSection(
        _ page: ScreenerPage,
        _ freshness: Freshness,
        error: FinScopeError?
    ) -> some View {
        if let error {
            Section {
                ErrorBanner(error: error) { await viewModel.refresh() }
            }
            .listRowBackground(Color.clear)
        }

        if page.rows.isEmpty {
            Section {
                EmptyState(
                    systemImage: "line.3.horizontal.decrease",
                    title: "Nothing matches",
                    message: "No company in the covered universe passes every filter. Loosen one to see more.",
                    actionTitle: "Edit filters"
                ) { viewModel.openFilters() }
            }
            .listRowBackground(Color.clear)
        } else {
            Section {
                ForEach(page.rows) { row in
                    Button {
                        onOpen(row.ticker, row.name)
                    } label: {
                        ScreenerRowView(row: row, metrics: rowMetrics(for: page))
                    }
                    .buttonStyle(.plain)
                }
            } header: {
                Text(viewModel.resultSummary)
                    .contentTransition(.numericText())
            } footer: {
                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    // The universe is the score's meaning, so it is stated on
                    // the screen that ranks by it.
                    Text("\(page.universeLabel) · universe \(page.universeVersion) · score \(page.scoreVersion)")
                    FreshnessLabel(freshness: freshness)
                    ForEach(page.warnings, id: \.self) { warning in
                        Text(warning)
                    }
                }
                .font(Theme.Typography.caption)
                .padding(.top, Theme.Spacing.sm)
            }
        }
    }
}

private struct ScreenerRowView: View {
    let row: ScreenerRow
    let metrics: [ScreenerMetric]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            HStack(alignment: .center, spacing: Theme.Spacing.md) {
                VStack(alignment: .leading, spacing: Theme.Spacing.hairline) {
                    Text(row.ticker)
                        .font(Theme.Typography.mono(.body, weight: .semibold))
                        .foregroundStyle(Theme.Color.textPrimary)
                    Text(row.name)
                        .font(Theme.Typography.footnote)
                        .foregroundStyle(Theme.Color.textSecondary)
                        .lineLimit(1)
                }
                Spacer(minLength: Theme.Spacing.sm)
                VStack(alignment: .trailing, spacing: Theme.Spacing.hairline) {
                    HStack(spacing: Theme.Spacing.sm) {
                        Text(Formatter.score(row.total))
                            .font(Theme.Typography.mono(.body, weight: .semibold))
                            .foregroundStyle(Theme.Color.textPrimary)
                        GradeBadge(grade: row.grade)
                    }
                    // An ungraded row shows the coverage that withheld the
                    // grade. Otherwise "73 NR" reads as a glitch rather than
                    // as a company that publishes too little to compare.
                    if !row.grade.isRated {
                        Text("\(Formatter.coverage(row.coverage)) covered")
                            .font(Theme.Typography.caption)
                            .foregroundStyle(Theme.Color.textTertiary)
                    }
                }
            }

            HStack(spacing: Theme.Spacing.lg) {
                ForEach(metrics) { metric in
                    HStack(spacing: Theme.Spacing.xs) {
                        Text(metric.compactLabel)
                            .font(Theme.Typography.caption)
                            .foregroundStyle(Theme.Color.textTertiary)
                        Text(row.metric(metric).map {
                            Formatter.number($0, unit: metric.unit)
                        } ?? Formatter.missing)
                            .font(Theme.Typography.mono(.caption, weight: .medium))
                            .foregroundStyle(Theme.Color.textSecondary)
                    }
                }
                Spacer(minLength: 0)
                if row.alertCount > 0 {
                    Label("\(row.alertCount)", systemImage: "exclamationmark.triangle")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Color.negative)
                        .accessibilityLabel("\(row.alertCount) alert\(row.alertCount == 1 ? "" : "s")")
                }
            }
            // A fixed height so a row with an alert is the same height as one
            // without: the symbol is taller than the caption beside it, and
            // the ragged rows it produced broke the list's separators.
            .frame(height: Theme.Size.metricLine)
        }
        .padding(.vertical, Theme.Spacing.xs)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel)
    }

    private var accessibilityLabel: String {
        var parts = [row.ticker, row.name, "score \(Formatter.score(row.total))"]
        parts.append(
            row.grade.isRated
                ? "grade \(row.grade.raw)"
                : "not rated, only \(Formatter.coverage(row.coverage)) of its metrics published"
        )
        for metric in metrics {
            let value = row.metric(metric).map { Formatter.number($0, unit: metric.unit) } ?? "unavailable"
            parts.append("\(metric.label) \(value)")
        }
        return parts.joined(separator: ", ")
    }
}

#if DEBUG
#Preview("Screener") {
    let dependencies = AppDependencies.preview()
    return NavigationStack {
        ScreenerView(
            viewModel: ScreenerViewModel(repository: dependencies.screener),
            onOpen: { _, _ in }
        )
    }
}
#endif
