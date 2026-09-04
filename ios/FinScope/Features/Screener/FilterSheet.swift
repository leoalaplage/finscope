import SwiftUI

/// The filters, in a sheet, in the sections the brief names.
///
/// Every control states its unit, and every metric slider offers "Any" as its
/// left-hand position rather than a zero that would silently exclude every
/// company with a negative figure. Editing happens on a draft, so dragging
/// four sliders is one reload rather than four.
struct FilterSheet: View {
    @Bindable var viewModel: ScreenerViewModel
    @Environment(\.dismiss) private var dismiss

    private var availableSectors: [String] {
        viewModel.page.value?.sectors ?? []
    }

    /// Metrics no company in this universe carried. Shown as disabled with
    /// their reason rather than hidden: a control that silently vanishes looks
    /// like a bug, and one that filters on nothing is worse.
    ///
    /// Read off the rows rather than from the response's `unavailableMetrics`,
    /// which names them in the engine's own keys and so never matched anything
    /// the app asked about.
    private var unavailableMetrics: Set<ScreenerMetric> {
        guard let rows = viewModel.page.value?.rows, !rows.isEmpty else { return [] }
        return Set(ScreenerMetric.allCases.filter { metric in
            !rows.contains { $0.metric(metric) != nil }
        })
    }

    var body: some View {
        NavigationStack {
            Form {
                scoreSection
                sizeSection
                ForEach([FilterSection.growth, .profitability, .balanceSheet, .valuation]) { section in
                    metricSection(section)
                }
                sectorSection
            }
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Reset") { viewModel.resetFilters() }
                        .disabled(viewModel.draftFilters.isEmpty)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Apply") { viewModel.applyDraft() }
                        .fontWeight(.semibold)
                }
            }
        }
        .presentationDetents([.large])
        .tint(Theme.Color.accent)
    }

    // MARK: - Score

    private var scoreSection: some View {
        Section {
            OptionalSlider(
                title: "Minimum score",
                unitSuffix: "",
                range: 0...100,
                step: 5,
                value: $viewModel.draftFilters.minimumScore
            )

            let grades = ["A+", "A", "A−", "B+", "B", "B−", "C+", "C", "C−", "D", "NR"]
            NavigationLink {
                MultiSelectList(
                    title: "Grades",
                    options: grades,
                    selection: $viewModel.draftFilters.grades
                )
            } label: {
                LabeledContent("Grades", value: summary(of: viewModel.draftFilters.grades))
            }

            Stepper(
                value: Binding(
                    get: { viewModel.draftFilters.maximumAlerts ?? 5 },
                    set: { viewModel.draftFilters.maximumAlerts = $0 >= 5 ? nil : $0 }
                ),
                in: 0...5
            ) {
                LabeledContent(
                    "Maximum alerts",
                    value: viewModel.draftFilters.maximumAlerts.map(String.init) ?? "Any"
                )
            }
        } header: {
            Text(FilterSection.score.label)
        } footer: {
            Text("Grades come from the same scored universe the fiche uses. Filtering never re-scores a company.")
        }
    }

    // MARK: - Size

    private var sizeSection: some View {
        Section(FilterSection.size.label) {
            OptionalSlider(
                title: "Minimum market cap",
                unitSuffix: " bn",
                range: 0...1000,
                step: 25,
                value: $viewModel.draftFilters.minimumMarketCapBillions
            )
        }
    }

    // MARK: - Metrics

    private func metricSection(_ section: FilterSection) -> some View {
        let metrics = ScreenerMetric.allCases.filter { $0.section == section }
        return Section(section.label) {
            ForEach(metrics) { metric in
                let isUnavailable = unavailableMetrics.contains(metric)
                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    OptionalSlider(
                        title: metric.higherIsBetter ? "\(metric.label) at least" : "\(metric.label) at most",
                        unitSuffix: metric.unit == .percent ? "%" : "",
                        range: bounds(for: metric),
                        step: metric.unit == .ratio ? 1 : 5,
                        value: Binding(
                            get: { viewModel.draftFilters.metricBounds[metric.key] },
                            set: { viewModel.draftFilters.metricBounds[metric.key] = $0 }
                        )
                    )
                    .disabled(isUnavailable)
                    if isUnavailable {
                        Text("No company in this universe publishes it, so it cannot filter anything.")
                            .font(Theme.Typography.caption)
                            .foregroundStyle(Theme.Color.textTertiary)
                    }
                }
            }
        }
    }

    /// The plausible span of each metric. Growth and returns go negative,
    /// because companies do.
    private func bounds(for metric: ScreenerMetric) -> ClosedRange<Double> {
        switch metric {
        case .roic, .operatingMargin, .fcfMargin: -20...80
        case .revenueGrowth, .fcfGrowth: -20...60
        case .fcfYield: -5...15
        case .netDebtToEbitda: 0...8
        case .evToFcf: 0...80
        }
    }

    // MARK: - Sector

    @ViewBuilder
    private var sectorSection: some View {
        if !availableSectors.isEmpty {
            Section(FilterSection.sector.label) {
                NavigationLink {
                    MultiSelectList(
                        title: "Sectors",
                        options: availableSectors,
                        selection: $viewModel.draftFilters.sectors
                    )
                } label: {
                    LabeledContent("Sectors", value: summary(of: viewModel.draftFilters.sectors))
                }
            }
        }
    }

    private func summary(of selection: Set<String>) -> String {
        switch selection.count {
        case 0: "Any"
        case 1: selection.first ?? "Any"
        default: "\(selection.count) selected"
        }
    }
}

/// A slider whose left-most position means "no filter", not "zero".
///
/// The distinction matters: a minimum ROIC of 0% excludes every company
/// posting a loss, which is a filter; "Any" is the absence of one. Collapsing
/// the two would make the sheet's default silently exclusive.
private struct OptionalSlider: View {
    let title: String
    let unitSuffix: String
    let range: ClosedRange<Double>
    let step: Double
    @Binding var value: Double?

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            HStack {
                Text(title)
                    .font(Theme.Typography.body)
                Spacer(minLength: Theme.Spacing.sm)
                Text(value.map { "\(Formatter.ratio($0).replacingOccurrences(of: ".00", with: ""))\(unitSuffix)" } ?? "Any")
                    .font(Theme.Typography.mono(.footnote, weight: .medium))
                    .foregroundStyle(value == nil ? Theme.Color.textTertiary : Theme.Color.accent)
            }
            HStack(spacing: Theme.Spacing.md) {
                Slider(
                    value: Binding(
                        get: { value ?? range.lowerBound },
                        set: { value = $0 }
                    ),
                    in: range,
                    step: step
                )
                if value != nil {
                    Button {
                        value = nil
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(Theme.Color.textTertiary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear \(title)")
                }
            }
        }
        .accessibilityElement(children: .contain)
    }
}

private struct MultiSelectList: View {
    let title: String
    let options: [String]
    @Binding var selection: Set<String>

    var body: some View {
        List {
            ForEach(options, id: \.self) { option in
                Button {
                    if selection.contains(option) {
                        selection.remove(option)
                    } else {
                        selection.insert(option)
                    }
                } label: {
                    HStack {
                        Text(option).foregroundStyle(Theme.Color.textPrimary)
                        Spacer()
                        if selection.contains(option) {
                            Image(systemName: "checkmark").foregroundStyle(Theme.Color.accent)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selection.contains(option) ? .isSelected : [])
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !selection.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Clear") { selection.removeAll() }
                }
            }
        }
    }
}

#if DEBUG
#Preview("Filters") {
    let dependencies = AppDependencies.preview()
    let viewModel = ScreenerViewModel(repository: dependencies.screener)
    return FilterSheet(viewModel: viewModel)
        .task { await viewModel.load() }
}
#endif
