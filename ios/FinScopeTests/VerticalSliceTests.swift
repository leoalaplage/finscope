import Foundation
import SwiftData
import Testing
@testable import FinScope

/// The first journey, end to end: search AAPL, open Apple, read its score and
/// its charts, follow it, close the app, reopen it, find it still there.
///
/// Run against the recorded fixtures and an in-memory store, so it exercises
/// the same repositories, view models and persistence the app runs on.
///
@Suite("The first journey")
@MainActor
struct VerticalSliceTests {

    /// An in-memory store and the two stores over it.
    ///
    /// The container is returned and must be **held for the whole test**: a
    /// `ModelContext` does not keep its container alive, so letting it go
    /// deallocates the store out from under the context mid-test. Binding it
    /// to `_` is what made three of these tests fail intermittently.
    private func makeStores() throws -> (ModelContainer, WatchlistStore, RecentSearchStore) {
        let container = try FinScopeModelContainer.make(inMemory: true)
        return (
            container,
            WatchlistStore(context: container.mainContext),
            RecentSearchStore(context: container.mainContext)
        )
    }

    @Test("Searching AAPL finds Apple, and opening it loads the fiche")
    func searchThenOpen() async throws {
        let repository = FixtureRepository(latency: .zero)
        let (container, watchlist, recents) = try makeStores()
        defer { withExtendedLifetime(container) {} }

        let search = SearchViewModel(repository: repository)
        search.query = "AAPL"
        search.submit()
        try await Task.sleep(for: .milliseconds(80))

        guard case .results(let results) = search.phase else {
            Issue.record("Expected results, got \(search.phase)")
            return
        }
        #expect(results.first?.ticker == "AAPL")

        recents.record(ticker: "AAPL", name: "Apple Inc.")
        #expect(recents.items.first?.ticker == "AAPL")

        let detail = StockDetailViewModel(
            ticker: "AAPL", repository: repository, watchlist: watchlist
        )
        await detail.load()

        let summary = try #require(detail.summary.value)
        #expect(summary.company.name == "Apple Inc.")
        #expect(detail.score.value?.summary.grade.isRated == true)

        // Revenue, ROIC and free cash flow — the three the brief asks to see.
        let bundle = try #require(detail.fundamentals.value)
        for metric in ["revenue", "roic", "freeCashFlow"] {
            let series = try #require(bundle.series(for: metric), "\(metric) is missing")
            #expect(series.isAvailable, "\(metric) should have values for Apple")
            #expect(!series.plottablePoints.isEmpty)
        }
        #expect(detail.selectedSeries?.metric == "revenue")
    }

    @Test("Following Apple survives the app being closed and reopened")
    func watchlistPersists() async throws {
        let container = try FinScopeModelContainer.make(inMemory: true)
        let repository = FixtureRepository(latency: .zero)

        do {
            let watchlist = WatchlistStore(context: container.mainContext)
            let detail = StockDetailViewModel(
                ticker: "AAPL", repository: repository, watchlist: watchlist
            )
            await detail.load()
            #expect(detail.isInWatchlist == false)
            detail.toggleWatchlist()
            #expect(detail.isInWatchlist)
        }

        // A fresh store over the same container is what a relaunch looks like:
        // the view models are gone, the rows are not.
        let reopened = WatchlistStore(context: container.mainContext)
        #expect(reopened.items.map(\.ticker) == ["AAPL"])
        #expect(reopened.contains("AAPL"))

        let entries = WatchlistViewModel(repository: repository, store: reopened)
        await entries.load()
        #expect(entries.entries.count == 1)
        #expect(entries.entries.first?.summary?.company.name == "Apple Inc.")
    }

    @Test("Reordering the watchlist renumbers every row exactly once")
    func watchlistReordering() throws {
        let (container, watchlist, _) = try makeStores()
        defer { withExtendedLifetime(container) {} }
        watchlist.add(ticker: "AAPL", name: "Apple Inc.")
        watchlist.add(ticker: "MSFT", name: "Microsoft Corporation")
        watchlist.add(ticker: "NVDA", name: "NVIDIA Corporation")

        watchlist.move(from: IndexSet(integer: 2), to: 0)
        #expect(watchlist.items.map(\.ticker) == ["NVDA", "AAPL", "MSFT"])
        #expect(watchlist.items.map(\.position) == [0, 1, 2])

        watchlist.remove(ticker: "AAPL")
        #expect(watchlist.items.map(\.ticker) == ["NVDA", "MSFT"])
        // Removing from the middle must close the gap, or a later reorder
        // writes two rows into one slot.
        #expect(watchlist.items.map(\.position) == [0, 1])
    }

    @Test("Adding the same company twice adds it once")
    func watchlistIsASet() throws {
        let (container, watchlist, _) = try makeStores()
        defer { withExtendedLifetime(container) {} }
        watchlist.add(ticker: "AAPL", name: "Apple Inc.")
        watchlist.add(ticker: "aapl", name: "Apple Inc.")
        #expect(watchlist.items.count == 1)
    }

    @Test("Recent searches keep the newest first and stay bounded")
    func recentsAreBounded() throws {
        let container = try FinScopeModelContainer.make(inMemory: true)
        let recents = RecentSearchStore(context: container.mainContext, limit: 3)

        for ticker in ["AAPL", "MSFT", "NVDA", "BKNG"] {
            recents.record(ticker: ticker, name: ticker)
        }
        #expect(recents.items.count == 3)
        #expect(recents.items.first?.ticker == "BKNG")

        recents.record(ticker: "MSFT", name: "Microsoft Corporation")
        #expect(recents.items.first?.ticker == "MSFT")
        #expect(recents.items.count == 3)
    }

    @Test("An empty query shows recents rather than 'no results'")
    func emptyQueryIsIdle() async throws {
        let search = SearchViewModel(repository: FixtureRepository(latency: .zero))
        search.query = "AAPL"
        search.submit()
        try await Task.sleep(for: .milliseconds(80))
        search.clear()
        #expect(search.phase == .idle)
    }

    @Test("A query that matches nothing says so, naming the query")
    func noResults() async throws {
        let search = SearchViewModel(repository: FixtureRepository(latency: .zero))
        search.query = "ZZZZ"
        search.submit()
        try await Task.sleep(for: .milliseconds(80))
        #expect(search.phase == .noResults(query: "ZZZZ"))
    }

    @Test("The fiche keeps its figures when a refresh fails")
    func refreshFailureKeepsData() async throws {
        let (container, watchlist, _) = try makeStores()
        defer { withExtendedLifetime(container) {} }
        let repository = FlakyRepository(inner: FixtureRepository(latency: .zero))

        let detail = StockDetailViewModel(
            ticker: "AAPL", repository: repository, watchlist: watchlist
        )
        await detail.load()
        let loaded = try #require(detail.summary.value)

        await repository.startFailing()
        await detail.refresh()

        // The state says failed and still carries the company: a lost
        // connection must not blank a screen the reader is looking at.
        #expect(detail.summary.error == .network)
        #expect(detail.summary.value?.company.ticker == loaded.company.ticker)
    }
}

/// A repository that answers normally until told to fail.
private actor FlakyRepository: CompanyRepository {
    private let inner: FixtureRepository
    private var isFailing = false

    init(inner: FixtureRepository) { self.inner = inner }

    func startFailing() { isFailing = true }

    func search(query: String) async throws -> [CompanySearchResult] {
        if isFailing { throw FinScopeError.network }
        return try await inner.search(query: query)
    }

    func summary(ticker: String) async throws -> Fetched<CompanySummary> {
        if isFailing { throw FinScopeError.network }
        return try await inner.summary(ticker: ticker)
    }

    func fundamentals(
        ticker: String,
        frequency: ReportingPeriod.Frequency
    ) async throws -> Fetched<FundamentalsBundle> {
        if isFailing { throw FinScopeError.network }
        return try await inner.fundamentals(ticker: ticker, frequency: frequency)
    }

    func score(ticker: String) async throws -> Fetched<QualityScore> {
        if isFailing { throw FinScopeError.network }
        return try await inner.score(ticker: ticker)
    }
}
