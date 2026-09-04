import SwiftUI

/// One followed company: ticker and score on the left of the eye, name and
/// move under it.
///
/// The layout is the one the brief asks for, and it is right: the ticker is
/// what you scan by, the score is what you came to check, and the name is
/// confirmation rather than content.
struct WatchlistRow: View {
    let entry: WatchlistEntry

    var body: some View {
        HStack(alignment: .center, spacing: Theme.Spacing.md) {
            VStack(alignment: .leading, spacing: Theme.Spacing.hairline) {
                Text(entry.item.ticker)
                    .font(Theme.Typography.mono(.body, weight: .semibold))
                    .foregroundStyle(Theme.Color.textPrimary)
                Text(entry.summary?.company.name ?? entry.item.name)
                    .font(Theme.Typography.footnote)
                    .foregroundStyle(Theme.Color.textSecondary)
                    .lineLimit(1)
            }

            Spacer(minLength: Theme.Spacing.sm)

            VStack(alignment: .trailing, spacing: Theme.Spacing.hairline) {
                if let score = entry.summary?.score {
                    HStack(spacing: Theme.Spacing.sm) {
                        Text(Formatter.score(score.total))
                            .font(Theme.Typography.mono(.body, weight: .semibold))
                            .foregroundStyle(Theme.Color.textPrimary)
                        GradeBadge(grade: score.grade)
                    }
                } else if entry.error != nil {
                    Image(systemName: "exclamationmark.triangle")
                        .font(Theme.Typography.footnote)
                        .foregroundStyle(Theme.Color.negative)
                } else {
                    Shimmer().frame(width: Theme.Size.skeletonWidthShort)
                }

                if let price = entry.summary?.price {
                    ChangeLabel(
                        changePercent: price.changePercent,
                        font: Theme.Typography.mono(.footnote, weight: .medium)
                    )
                }
            }
        }
        .padding(.vertical, Theme.Spacing.xs)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel)
    }

    private var accessibilityLabel: String {
        var parts = [entry.item.ticker, entry.summary?.company.name ?? entry.item.name]
        if let score = entry.summary?.score {
            parts.append("score \(Formatter.score(score.total)), grade \(score.grade.raw)")
        }
        if let change = entry.summary?.price?.changePercent {
            parts.append("\(change < 0 ? "down" : "up") \(Formatter.percentagePoints(abs(change), fractionDigits: 2)) today")
        }
        if let error = entry.error {
            parts.append("last refresh failed: \(error.title)")
        }
        return parts.joined(separator: ", ")
    }
}

struct WatchlistView: View {
    @Bindable var viewModel: WatchlistViewModel
    let onOpen: (String, String) -> Void
    let onSearch: () -> Void

    @State private var isEditing = false

    var body: some View {
        Group {
            if viewModel.isEmpty {
                EmptyState(
                    systemImage: "star",
                    title: "No companies yet",
                    message: "Search for a company and tap the star to follow it. Your list stays on this device.",
                    actionTitle: "Search"
                ) { onSearch() }
            } else {
                list
            }
        }
        .navigationTitle("Watchlist")
        .toolbar {
            if !viewModel.isEmpty {
                ToolbarItem(placement: .topBarTrailing) {
                    EditButton().tint(Theme.Color.accent)
                }
            }
        }
        .task { await viewModel.load() }
    }

    private var list: some View {
        List {
            Section {
                ForEach(viewModel.entries) { entry in
                    Button {
                        onOpen(entry.item.ticker, entry.summary?.company.name ?? entry.item.name)
                    } label: {
                        WatchlistRow(entry: entry)
                    }
                    .buttonStyle(.plain)
                }
                .onMove { source, destination in viewModel.move(from: source, to: destination) }
                .onDelete { offsets in viewModel.delete(at: offsets) }
            } footer: {
                if let freshness = viewModel.freshness {
                    FreshnessLabel(freshness: freshness)
                        .padding(.top, Theme.Spacing.sm)
                }
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .background(Theme.Color.background)
        .refreshable { await viewModel.refresh() }
    }
}

#if DEBUG
#Preview("Watchlist") {
    let dependencies = AppDependencies.preview()
    return NavigationStack {
        WatchlistView(
            viewModel: WatchlistViewModel(
                repository: dependencies.companies,
                store: dependencies.watchlist
            ),
            onOpen: { _, _ in },
            onSearch: {}
        )
    }
}

#Preview("Watchlist · empty") {
    let dependencies = AppDependencies.preview(seedWatchlist: false)
    return NavigationStack {
        WatchlistView(
            viewModel: WatchlistViewModel(
                repository: dependencies.companies,
                store: dependencies.watchlist
            ),
            onOpen: { _, _ in },
            onSearch: {}
        )
    }
}
#endif
