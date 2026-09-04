import SwiftUI

/// Four tabs, a navigation stack each, one routing table.
///
/// The switcher is the system tab bar, styled monochrome, rather than custom
/// chrome above the navigation bar. A top switcher sat *over* the back button
/// on every pushed screen, and the paged `TabView` carrying it took the
/// leading inset off every large title — "FinScope" and "QS Screener" were
/// both clipped against the edge of the display — while swallowing the
/// horizontal swipes that the recents carousel and the back gesture need.
struct RootView: View {
    let dependencies: AppDependencies

    @State private var router = AppRouter()
    @State private var homeViewModel: HomeViewModel
    @State private var watchlistViewModel: WatchlistViewModel
    @State private var searchViewModel: SearchViewModel
    @State private var screenerViewModel: ScreenerViewModel

    @AppStorage(PreferenceKey.appearance) private var appearanceRaw = Appearance.system.rawValue

    init(dependencies: AppDependencies) {
        self.dependencies = dependencies
        _homeViewModel = State(initialValue: HomeViewModel(repository: dependencies.dataStatus))
        // One instance, shared by Home's preview and the Watchlist tab: the
        // same rows, refreshed once, in both places.
        _watchlistViewModel = State(
            initialValue: WatchlistViewModel(
                repository: dependencies.companies,
                store: dependencies.watchlist
            )
        )
        _searchViewModel = State(initialValue: SearchViewModel(repository: dependencies.companies))
        _screenerViewModel = State(initialValue: ScreenerViewModel(repository: dependencies.screener))
    }

    private var appearance: Appearance {
        Appearance(rawValue: appearanceRaw) ?? .system
    }

    /// Selecting the tab you are already on pops it back to its root, which is
    /// what the system tab bar does everywhere else on the phone.
    private var tabSelection: Binding<AppRouter.Tab> {
        Binding(
            get: { router.selectedTab },
            set: { tab in
                if tab == router.selectedTab {
                    router.popToRoot()
                } else {
                    router.selectedTab = tab
                }
                Haptics.selection()
            }
        )
    }

    var body: some View {
        @Bindable var router = router
        TabView(selection: tabSelection) {
                NavigationStack(path: $router.homePath) {
                    HomeView(
                        viewModel: homeViewModel,
                        watchlist: watchlistViewModel,
                        recents: dependencies.recents,
                        onOpen: open,
                        onOpenWatchlist: { router.selectedTab = .watchlist },
                        onOpenScreener: { router.selectedTab = .screener },
                        onOpenSettings: { router.push(.settings, in: .home) }
                    )
                    .navigationDestination(for: AppRouter.Route.self, destination: destination)
                }
                .tabItem { Label(AppRouter.Tab.home.label, systemImage: AppRouter.Tab.home.systemImage) }
                .tag(AppRouter.Tab.home)

                NavigationStack(path: $router.searchPath) {
                    SearchView(
                        viewModel: searchViewModel,
                        recents: dependencies.recents,
                        onOpen: open
                    )
                    .navigationDestination(for: AppRouter.Route.self, destination: destination)
                }
                .tabItem { Label(AppRouter.Tab.search.label, systemImage: AppRouter.Tab.search.systemImage) }
                .tag(AppRouter.Tab.search)

                NavigationStack(path: $router.screenerPath) {
                    ScreenerView(viewModel: screenerViewModel, onOpen: open)
                        .navigationDestination(for: AppRouter.Route.self, destination: destination)
                }
                .tabItem { Label(AppRouter.Tab.screener.label, systemImage: AppRouter.Tab.screener.systemImage) }
                .tag(AppRouter.Tab.screener)

                NavigationStack(path: $router.watchlistPath) {
                    WatchlistView(
                        viewModel: watchlistViewModel,
                        onOpen: open,
                        onSearch: { router.selectedTab = .search }
                    )
                    .navigationDestination(for: AppRouter.Route.self, destination: destination)
                }
                .tabItem { Label(AppRouter.Tab.watchlist.label, systemImage: AppRouter.Tab.watchlist.systemImage) }
                .tag(AppRouter.Tab.watchlist)
        }
        .environment(router)
        // No app-wide `.fontDesign(.monospaced)`. It reached the navigation
        // titles, the tab bar and every system control, which is how the type
        // ended up looking oversized in some places and cramped in others.
        // The voices are chosen per string in `Theme.Typography` instead.
        .tint(Theme.Color.accent)
        .preferredColorScheme(appearance.colorScheme)
        .onOpenURL { router.handle($0) }
#if DEBUG
        .task { applyDebugRouteIfNeeded() }
#endif
    }

#if DEBUG
    /// Routes the app from the command line so every screen can be captured
    /// without a hand on the device:
    ///
    ///     -ui-route stock|score|section|screener|watchlist|settings|methodology
    ///     -ui-seed-watchlist
    ///
    /// Debug-only, and it drives the real dependencies — the same repositories
    /// and the same store — so a capture taken this way is a capture of the
    /// app, not of a stub arranged to look like one.
    private func applyDebugRouteIfNeeded() {
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("-ui-seed-watchlist"), dependencies.watchlist.items.isEmpty {
            for (ticker, name) in [
                ("AAPL", "Apple Inc."),
                ("MSFT", "Microsoft Corporation"),
                ("NVDA", "NVIDIA Corporation"),
                ("CME", "CME Group Inc."),
            ] {
                dependencies.watchlist.add(ticker: ticker, name: name)
                dependencies.recents.record(ticker: ticker, name: name)
            }
        }

        guard let flag = arguments.firstIndex(of: "-ui-route"),
              arguments.indices.contains(flag + 1) else { return }
        let ticker = arguments.firstIndex(of: "-ui-ticker")
            .flatMap { arguments.indices.contains($0 + 1) ? arguments[$0 + 1] : nil }
            ?? "AAPL"

        switch arguments[flag + 1] {
        case "stock":
            router.selectedTab = .search
            router.searchPath = [.stock(ticker: ticker)]
        case "score":
            router.selectedTab = .search
            router.searchPath = [.stock(ticker: ticker), .score(ticker: ticker)]
        case "section":
            router.selectedTab = .search
            router.searchPath = [.stock(ticker: ticker), .section(ticker: ticker, section: .cashFlow)]
        case "screener":
            router.selectedTab = .screener
        case "watchlist":
            router.selectedTab = .watchlist
        case "settings":
            router.selectedTab = .home
            router.homePath = [.settings]
        case "methodology":
            router.selectedTab = .home
            router.homePath = [.settings, .methodology]
        default:
            router.selectedTab = .home
        }
    }
#endif

    /// Opening a company records it as recent and pushes the fiche onto the
    /// tab the reader is on.
    private func open(ticker: String, name: String) {
        dependencies.recents.record(ticker: ticker, name: name)
        router.showStock(ticker)
    }

    /// One routing table for all four stacks.
    @ViewBuilder
    private func destination(for route: AppRouter.Route) -> some View {
        switch route {
        case .stock(let ticker):
            StockDetailDestination(ticker: ticker, dependencies: dependencies)
                .id(ticker)
        case .score(let ticker):
            StockDetailDestination(ticker: ticker, dependencies: dependencies, screen: .score)
                .id("score-\(ticker)")
        case .section(let ticker, let section):
            StockDetailDestination(ticker: ticker, dependencies: dependencies, screen: .section(section))
                .id("\(section.rawValue)-\(ticker)")
        case .settings:
            SettingsView(
                dataStatus: homeViewModel,
                onOpenMethodology: { router.push(.methodology, in: .home) },
                cache: dependencies.cache
            )
        case .methodology:
            MethodologyView()
        }
    }
}

/// FinScope's primary navigation: compact, ruled and deliberately flat. The
/// active section is the only filled element in the rail.

/// Owns one `StockDetailViewModel` for the lifetime of a pushed fiche.
///
/// The view model is created here rather than in the routing table so that
/// pushing the score or a section screen for a company already open reuses
/// nothing — each push is its own screen with its own loads. Keeping one
/// shared instance across pushes would mean a section screen silently
/// changing the fiche's chart frequency behind it.
private struct StockDetailDestination: View {
    enum Screen {
        case fiche
        case score
        case section(FundamentalSection)
    }

    let ticker: String
    let dependencies: AppDependencies
    var screen: Screen = .fiche

    @State private var viewModel: StockDetailViewModel

    init(ticker: String, dependencies: AppDependencies, screen: Screen = .fiche) {
        self.ticker = ticker
        self.dependencies = dependencies
        self.screen = screen
        _viewModel = State(
            initialValue: StockDetailViewModel(
                ticker: ticker,
                repository: dependencies.companies,
                watchlist: dependencies.watchlist
            )
        )
    }

    var body: some View {
        switch screen {
        case .fiche:
            StockDetailView(viewModel: viewModel)
        case .score:
            ScoreDetailView(viewModel: viewModel)
        case .section(let section):
            SectionDetailView(section: section, viewModel: viewModel)
        }
    }
}

#if DEBUG
#Preview("FinScope") {
    RootView(dependencies: .preview())
}

#Preview("FinScope · dark") {
    RootView(dependencies: .preview())
        .preferredColorScheme(.dark)
}
#endif
