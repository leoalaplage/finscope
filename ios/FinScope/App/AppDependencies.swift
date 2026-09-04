import Foundation
import Observation
import SwiftData

/// The composition root: the one place that decides where data comes from.
///
/// Manual composition, no DI framework. Everything above this type talks to
/// the repository protocols, so swapping the recorded fixtures for `/v1` is a
/// change to `live(...)` and to nothing else — no screen, no view model and no
/// test has to know which one it is running against.
@MainActor
@Observable
final class AppDependencies {
    let companies: any CompanyRepository
    let screener: any ScreenerRepository
    let dataStatus: any DataStatusRepository
    let watchlist: WatchlistStore
    let recents: RecentSearchStore

    @ObservationIgnored let cache: ResponseCache?

    init(
        companies: any CompanyRepository,
        screener: any ScreenerRepository,
        dataStatus: any DataStatusRepository,
        watchlist: WatchlistStore,
        recents: RecentSearchStore,
        cache: ResponseCache? = nil
    ) {
        self.companies = companies
        self.screener = screener
        self.dataStatus = dataStatus
        self.watchlist = watchlist
        self.recents = recents
        self.cache = cache
    }

    /// The app as shipped.
    ///
    /// Reads the recorded `/v1` fixtures, because `/v1` is Codex's and does
    /// not answer yet. The figures are real — recorded from the deployed
    /// engine — so nothing on screen is a placeholder waiting to be believed.
    /// When the endpoints exist, `FixtureRepository()` below becomes
    /// `LiveRepository(api: APIClient(), cache: cache)` and the rest of the
    /// app does not move.
    static func live(container: ModelContainer) -> AppDependencies {
        let context = container.mainContext
        let cache = ResponseCache(modelContainer: container)
        let repository = FixtureRepository()
        return AppDependencies(
            companies: repository,
            screener: repository,
            dataStatus: repository,
            watchlist: WatchlistStore(context: context),
            recents: RecentSearchStore(context: context),
            cache: cache
        )
    }
}

#if DEBUG
extension AppDependencies {
    /// Previews and tests: the same recorded fixtures, in memory, without the
    /// artificial latency that exists to make loading states visible.
    static func preview(seedWatchlist: Bool = true) -> AppDependencies {
        let container = try! FinScopeModelContainer.make(inMemory: true)
        let context = container.mainContext
        let repository = FixtureRepository(latency: .zero)
        let watchlist = WatchlistStore(context: context)
        if seedWatchlist {
            watchlist.add(ticker: "AAPL", name: "Apple Inc.")
            watchlist.add(ticker: "MSFT", name: "Microsoft Corporation")
            watchlist.add(ticker: "NVDA", name: "NVIDIA Corporation")
        }
        return AppDependencies(
            companies: repository,
            screener: repository,
            dataStatus: repository,
            watchlist: watchlist,
            recents: RecentSearchStore(context: context)
        )
    }
}
#endif
