import Observation
import SwiftUI

/// Home's own state: how current FinScope's reading is.
///
/// The watchlist below it belongs to `WatchlistViewModel`, which the two
/// screens share so that a refresh on either is a refresh for both.
@MainActor
@Observable
final class HomeViewModel {
    private(set) var status: LoadState<DataStatus> = .idle

    @ObservationIgnored private let repository: any DataStatusRepository

    init(repository: any DataStatusRepository) {
        self.repository = repository
    }

    func load() async {
        guard case .idle = status else { return }
        await refresh()
    }

    func refresh() async {
        status = status.refreshing()
        do {
            let fetched = try await repository.status()
            status = .loaded(fetched.value, fetched.freshness)
        } catch FinScopeError.cancelled {
            return
        } catch let error as FinScopeError {
            status = status.failed(error)
        } catch {
            status = status.failed(.unknown(error.localizedDescription))
        }
    }
}

/// Home.
///
/// A header that says how current the data is, a slice of the watchlist, the
/// companies opened recently, and one door to the screener. No news, no
/// carousel, no copy. What a reader wants on opening a research tool is the
/// state of their own list and a way into everything else.
struct HomeView: View {
    @Bindable var viewModel: HomeViewModel
    @Bindable var watchlist: WatchlistViewModel
    let recents: RecentSearchStore
    let onOpen: (String, String) -> Void
    let onOpenWatchlist: () -> Void
    let onOpenScreener: () -> Void
    let onOpenSettings: () -> Void

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: Theme.Spacing.xl) {
                statusHeader
                watchlistPreview
                recentsSection
                screenerCard
            }
            .padding(.horizontal, Theme.Spacing.lg)
            .padding(.vertical, Theme.Spacing.lg)
        }
        .background(Theme.Color.background)
        .navigationTitle("FinScope")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { onOpenSettings() } label: { Image(systemName: "gearshape") }
                    .tint(Theme.Color.accent)
                    .accessibilityLabel("Settings")
            }
        }
        .refreshable {
            await viewModel.refresh()
            await watchlist.refresh()
        }
        .task {
            await viewModel.load()
            await watchlist.load()
        }
    }

    // MARK: - Header

    @ViewBuilder
    private var statusHeader: some View {
        switch viewModel.status {
        case .idle, .loading:
            Shimmer(height: Theme.Size.skeletonCaption).frame(width: Theme.Size.skeletonWidthLong)
        case .failed(nil, _, let error):
            ErrorBanner(error: error) { await viewModel.refresh() }
        case .loaded(let status, let freshness), .refreshing(let status, let freshness):
            statusLine(status, freshness)
        case .failed(.some(let status), let freshness, _):
            statusLine(status, freshness ?? .unknown)
        }
    }

    private func statusLine(_ status: DataStatus, _ freshness: Freshness) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            HStack(spacing: Theme.Spacing.sm) {
                Text("\(status.universeSize) companies covered")
                    .font(Theme.Typography.footnote)
                    .foregroundStyle(Theme.Color.textSecondary)
                // "Behind" means a company has filed something FinScope has
                // not read yet. Worth one quiet clause; never worth hiding —
                // and stated out of the number actually checked, not out of
                // the whole universe.
                if status.behindCount > 0 {
                    Text("· \(status.behindCount) of \(status.checkedCount) checked is behind")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Color.textTertiary)
                }
            }
            if let readAt = status.lastReadAt {
                FreshnessLabel(
                    freshness: Freshness(
                        asOf: nil, retrievedAt: readAt,
                        dataVersion: status.dataVersion, isFromCache: freshness.isFromCache
                    )
                )
            }
        }
    }

    // MARK: - Watchlist

    @ViewBuilder
    private var watchlistPreview: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            SectionHeader(title: "Watchlist") {
                if !watchlist.isEmpty {
                    Button("See all") { onOpenWatchlist() }
                        .font(Theme.Typography.caption)
                        .textCase(nil)
                        .tint(Theme.Color.accent)
                }
            }

            if watchlist.isEmpty {
                Card {
                    VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                        Text(verbatim: "Nothing followed yet")
                            .font(Theme.Typography.headline)
                        Text(verbatim: "Open a company and tap the star to see it here.")
                            .font(Theme.Typography.footnote)
                            .foregroundStyle(Theme.Color.textSecondary)
                    }
                }
            } else {
                Card(padding: 0) {
                    VStack(spacing: 0) {
                        let preview = Array(watchlist.entries.prefix(Theme.Count.watchlistPreview))
                        ForEach(Array(preview.enumerated()), id: \.element.id) { index, entry in
                            Button {
                                onOpen(entry.item.ticker, entry.summary?.company.name ?? entry.item.name)
                            } label: {
                                WatchlistRow(entry: entry)
                                    .padding(.horizontal, Theme.Spacing.lg)
                                    .padding(.vertical, Theme.Spacing.md)
                            }
                            .buttonStyle(.plain)
                            if index < preview.count - 1 {
                                Divider().padding(.leading, Theme.Spacing.lg)
                            }
                        }
                    }
                }
            }
        }
    }

    // MARK: - Recents

    @ViewBuilder
    private var recentsSection: some View {
        if !recents.items.isEmpty {
            VStack(alignment: .leading, spacing: Theme.Spacing.md) {
                SectionHeader("Recently opened")
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: Theme.Spacing.sm) {
                        ForEach(recents.items) { item in
                            Button {
                                onOpen(item.ticker, item.name)
                            } label: {
                                VStack(alignment: .leading, spacing: Theme.Spacing.hairline) {
                                    Text(item.ticker)
                                        .font(Theme.Typography.mono(.footnote, weight: .semibold))
                                        .foregroundStyle(Theme.Color.textPrimary)
                                    Text(item.name)
                                        .font(Theme.Typography.caption)
                                        .foregroundStyle(Theme.Color.textSecondary)
                                        .lineLimit(1)
                                }
                                .padding(.horizontal, Theme.Spacing.md)
                                .padding(.vertical, Theme.Spacing.group)
                                .frame(minWidth: 110, alignment: .leading)
                                .background(Theme.Color.surface)
                                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm, style: .continuous))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, Theme.Spacing.lg)
                }
                .padding(.horizontal, -Theme.Spacing.lg)
            }
        }
    }

    // MARK: - Screener

    private var screenerCard: some View {
        Card(padding: 0) {
            DisclosureRow(action: onOpenScreener) {
                VStack(alignment: .leading, spacing: Theme.Spacing.hairline) {
                    Text(verbatim: "QS Screener")
                        .font(Theme.Typography.headline)
                        .foregroundStyle(Theme.Color.textPrimary)
                    Text(verbatim: "Rank the covered universe by Quality Score")
                        .font(Theme.Typography.footnote)
                        .foregroundStyle(Theme.Color.textSecondary)
                }
            }
            .padding(Theme.Spacing.lg)
        }
    }
}

#if DEBUG
#Preview("Home") {
    let dependencies = AppDependencies.preview()
    return NavigationStack {
        HomeView(
            viewModel: HomeViewModel(repository: dependencies.dataStatus),
            watchlist: WatchlistViewModel(
                repository: dependencies.companies,
                store: dependencies.watchlist
            ),
            recents: dependencies.recents,
            onOpen: { _, _ in },
            onOpenWatchlist: {},
            onOpenScreener: {},
            onOpenSettings: {}
        )
    }
}

#Preview("Home · nothing followed") {
    let dependencies = AppDependencies.preview(seedWatchlist: false)
    return NavigationStack {
        HomeView(
            viewModel: HomeViewModel(repository: dependencies.dataStatus),
            watchlist: WatchlistViewModel(
                repository: dependencies.companies,
                store: dependencies.watchlist
            ),
            recents: dependencies.recents,
            onOpen: { _, _ in },
            onOpenWatchlist: {},
            onOpenScreener: {},
            onOpenSettings: {}
        )
    }
    .preferredColorScheme(.dark)
}
#endif
