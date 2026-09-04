import Foundation
import Observation

/// One watchlist line: what the reader stored, plus whatever the backend
/// currently says about it.
///
/// The two are kept apart on purpose. `item` is theirs and works offline;
/// `summary` is the server's and may be absent, stale or failed — and the row
/// renders correctly in all three cases rather than waiting for it.
struct WatchlistEntry: Identifiable, Sendable {
    let item: WatchlistItem
    var summary: CompanySummary?
    var freshness: Freshness?
    var error: FinScopeError?

    var id: String { item.ticker }
}

/// Loads the figures for the followed companies.
@MainActor
@Observable
final class WatchlistViewModel {
    private(set) var entries: [WatchlistEntry] = []
    private(set) var isRefreshing = false

    @ObservationIgnored private let repository: any CompanyRepository
    @ObservationIgnored let store: WatchlistStore
    @ObservationIgnored private var refreshTask: Task<Void, Never>?

    init(repository: any CompanyRepository, store: WatchlistStore) {
        self.repository = repository
        self.store = store
        syncFromStore()
    }

    var isEmpty: Bool { store.items.isEmpty }

    /// The freshest read across the rows, for the header's dateline.
    var freshness: Freshness? {
        entries.compactMap(\.freshness).max { left, right in
            (left.retrievedAt ?? .distantPast) < (right.retrievedAt ?? .distantPast)
        }
    }

    func load() async {
        syncFromStore()
        guard entries.contains(where: { $0.summary == nil }) else { return }
        await refresh()
    }

    /// Fetches every row concurrently. One company failing leaves the others
    /// alone; the failure lands on its own line.
    func refresh() async {
        refreshTask?.cancel()
        syncFromStore()
        guard !entries.isEmpty else { return }

        isRefreshing = true
        defer { isRefreshing = false }

        let tickers = entries.map(\.item.ticker)
        let task = Task {
            await withTaskGroup(of: (String, Result<Fetched<CompanySummary>, FinScopeError>).self) { group in
                for ticker in tickers {
                    group.addTask { [repository] in
                        do {
                            return (ticker, .success(try await repository.summary(ticker: ticker)))
                        } catch let error as FinScopeError {
                            return (ticker, .failure(error))
                        } catch {
                            return (ticker, .failure(.unknown(error.localizedDescription)))
                        }
                    }
                }
                for await (ticker, result) in group {
                    guard let index = entries.firstIndex(where: { $0.item.ticker == ticker }) else { continue }
                    switch result {
                    case .success(let fetched):
                        entries[index].summary = fetched.value
                        entries[index].freshness = fetched.freshness
                        entries[index].error = nil
                    case .failure(let error):
                        // A failed refresh keeps the figures already on the
                        // row. What changes is that the row now says so.
                        guard error != .cancelled else { continue }
                        entries[index].error = error
                    }
                }
            }
        }
        refreshTask = task
        await task.value
    }

    func move(from source: IndexSet, to destination: Int) {
        store.move(from: source, to: destination)
        syncFromStore()
    }

    func delete(at offsets: IndexSet) {
        store.delete(at: offsets)
        syncFromStore()
    }

    func remove(ticker: String) {
        store.remove(ticker: ticker)
        syncFromStore()
    }

    // MARK: - Private

    /// Rebuilds the rows from the store, keeping figures already fetched for
    /// tickers that are still there.
    private func syncFromStore() {
        let existing = Dictionary(uniqueKeysWithValues: entries.map { ($0.id, $0) })
        entries = store.items.map { item in
            if var kept = existing[item.ticker] {
                kept = WatchlistEntry(
                    item: item, summary: kept.summary,
                    freshness: kept.freshness, error: kept.error
                )
                return kept
            }
            return WatchlistEntry(item: item)
        }
    }
}
