import SwiftUI

struct SearchView: View {
    @Bindable var viewModel: SearchViewModel
    let recents: RecentSearchStore
    let onOpen: (String, String) -> Void

    var body: some View {
        List {
            switch viewModel.phase {
            case .idle:
                recentSection
            case .searching:
                Section {
                    ForEach(0..<3, id: \.self) { _ in CompanyRowPlaceholder() }
                }
                .listRowBackground(Color.clear)
            case .results(let results):
                Section {
                    ForEach(results) { result in
                        Button {
                            onOpen(result.ticker, result.name)
                        } label: {
                            SearchResultRow(result: result)
                        }
                        .buttonStyle(.plain)
                    }
                } header: {
                    Text("\(results.count) \(results.count == 1 ? "company" : "companies")")
                }
            case .noResults(let query):
                Section {
                    EmptyState(
                        systemImage: "magnifyingglass",
                        title: "Nothing for “\(query)”",
                        message: "FinScope searches US SEC filers by ticker and by name."
                    )
                }
                .listRowBackground(Color.clear)
            case .failed(let error):
                Section {
                    ErrorView(error: error) { await viewModel.retry() }
                }
                .listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .scrollDismissesKeyboard(.immediately)
        .navigationTitle("Search")
        .searchable(
            text: $viewModel.query,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: "Ticker or company name"
        )
        .textInputAutocapitalization(.characters)
        .autocorrectionDisabled()
        .onSubmit(of: .search) { viewModel.submit() }
    }

    @ViewBuilder
    private var recentSection: some View {
        if recents.items.isEmpty {
            Section {
                EmptyState(
                    systemImage: "magnifyingglass",
                    title: "Find a company",
                    message: "Type a ticker like AAPL, or a name like Apple."
                )
            }
            .listRowBackground(Color.clear)
        } else {
            Section {
                ForEach(recents.items) { item in
                    Button {
                        onOpen(item.ticker, item.name)
                    } label: {
                        HStack(spacing: Theme.Spacing.md) {
                            Text(item.ticker)
                                .font(Theme.Typography.mono(.body, weight: .semibold))
                                .foregroundStyle(Theme.Color.textPrimary)
                                .frame(width: 62, alignment: .leading)
                            Text(item.name)
                                .font(Theme.Typography.callout)
                                .foregroundStyle(Theme.Color.textSecondary)
                                .lineLimit(1)
                            Spacer(minLength: 0)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            } header: {
                HStack {
                    Text("Recent")
                    Spacer()
                    Button("Clear") { recents.clear() }
                        .font(Theme.Typography.caption)
                        .textCase(nil)
                }
            }
        }
    }
}

private struct SearchResultRow: View {
    let result: CompanySearchResult

    var body: some View {
        HStack(alignment: .center, spacing: Theme.Spacing.md) {
            VStack(alignment: .leading, spacing: Theme.Spacing.hairline) {
                Text(result.ticker)
                    .font(Theme.Typography.mono(.body, weight: .semibold))
                    .foregroundStyle(Theme.Color.textPrimary)
                Text(result.name)
                    .font(Theme.Typography.footnote)
                    .foregroundStyle(Theme.Color.textSecondary)
                    .lineLimit(1)
            }
            Spacer(minLength: Theme.Spacing.sm)
            VStack(alignment: .trailing, spacing: Theme.Spacing.hairline) {
                if let sector = result.sector {
                    Text(sector)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Color.textTertiary)
                        .lineLimit(1)
                }
                // Saying so up front is kinder than a spinner that turns into
                // a "building" screen after the tap.
                if !result.isCovered {
                    Text(verbatim: "Not yet built")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Color.textTertiary)
                }
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens \(result.name)")
    }
}

#if DEBUG
#Preview("Search") {
    let dependencies = AppDependencies.preview()
    return NavigationStack {
        SearchView(
            viewModel: SearchViewModel(repository: dependencies.companies),
            recents: dependencies.recents,
            onOpen: { _, _ in }
        )
    }
}
#endif
