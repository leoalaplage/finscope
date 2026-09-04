import Foundation
import Observation
import SwiftData

/// One followed company, as the device remembers it.
///
/// Deliberately thin. The ticker, the name to show before anything loads, the
/// order the reader chose, and when they added it — nothing else. The moment
/// this type carried a price or a score, the watchlist would be a second
/// source of truth for figures the backend owns, and the two would drift.
struct WatchlistItem: Identifiable, Hashable, Sendable {
    let ticker: String
    let name: String
    let addedAt: Date
    var position: Int

    var id: String { ticker }
}

/// The reader's watchlist. Available offline, because it is theirs.
@MainActor
@Observable
final class WatchlistStore {
    private(set) var items: [WatchlistItem] = []

    @ObservationIgnored private let context: ModelContext

    init(context: ModelContext) {
        self.context = context
        reload()
    }

    func contains(_ ticker: String) -> Bool {
        items.contains { $0.ticker == ticker.uppercased() }
    }

    /// Adds a company at the end of the list. Adding one already there is a
    /// no-op rather than a duplicate or an error.
    func add(ticker: String, name: String) {
        let ticker = ticker.uppercased()
        guard !contains(ticker) else { return }
        context.insert(
            WatchlistEntity(ticker: ticker, name: name, position: items.count)
        )
        save()
    }

    func remove(ticker: String) {
        let ticker = ticker.uppercased()
        let descriptor = FetchDescriptor<WatchlistEntity>(
            predicate: #Predicate { $0.ticker == ticker }
        )
        for entity in (try? context.fetch(descriptor)) ?? [] { context.delete(entity) }
        save()
        renumber()
    }

    func toggle(ticker: String, name: String) {
        contains(ticker) ? remove(ticker: ticker) : add(ticker: ticker, name: name)
    }

    /// Applies a drag reorder. Positions are rewritten from the resulting
    /// order rather than patched, so no two rows can end up claiming one slot.
    func move(from source: IndexSet, to destination: Int) {
        var reordered = items
        reordered.move(fromOffsets: source, toOffset: destination)
        let order = Dictionary(
            uniqueKeysWithValues: reordered.enumerated().map { ($0.element.ticker, $0.offset) }
        )
        for entity in fetchEntities() {
            if let position = order[entity.ticker] { entity.position = position }
        }
        save()
    }

    func delete(at offsets: IndexSet) {
        for index in offsets where items.indices.contains(index) {
            remove(ticker: items[index].ticker)
        }
    }

    // MARK: - Private

    private func fetchEntities() -> [WatchlistEntity] {
        let descriptor = FetchDescriptor<WatchlistEntity>(
            sortBy: [SortDescriptor(\.position, order: .forward)]
        )
        return (try? context.fetch(descriptor)) ?? []
    }

    private func renumber() {
        for (index, entity) in fetchEntities().enumerated() { entity.position = index }
        save()
    }

    private func save() {
        try? context.save()
        reload()
    }

    private func reload() {
        items = fetchEntities().map {
            WatchlistItem(ticker: $0.ticker, name: $0.name, addedAt: $0.addedAt, position: $0.position)
        }
    }
}

/// The last few companies opened, so Search has something useful to show
/// before a single character is typed.
@MainActor
@Observable
final class RecentSearchStore {
    private(set) var items: [WatchlistItem] = []

    @ObservationIgnored private let context: ModelContext
    @ObservationIgnored private let limit: Int

    init(context: ModelContext, limit: Int = Theme.Count.recentSearches) {
        self.context = context
        self.limit = limit
        reload()
    }

    /// Records an opened company, moving it to the front if it was already there.
    func record(ticker: String, name: String) {
        let ticker = ticker.uppercased()
        let descriptor = FetchDescriptor<RecentSearchEntity>(
            predicate: #Predicate { $0.ticker == ticker }
        )
        if let existing = (try? context.fetch(descriptor))?.first {
            existing.openedAt = .now
            existing.name = name
        } else {
            context.insert(RecentSearchEntity(ticker: ticker, name: name))
        }
        try? context.save()
        trim()
        reload()
    }

    func clear() {
        for entity in fetchEntities() { context.delete(entity) }
        try? context.save()
        reload()
    }

    // MARK: - Private

    private func fetchEntities() -> [RecentSearchEntity] {
        let descriptor = FetchDescriptor<RecentSearchEntity>(
            sortBy: [SortDescriptor(\.openedAt, order: .reverse)]
        )
        return (try? context.fetch(descriptor)) ?? []
    }

    private func trim() {
        let entities = fetchEntities()
        guard entities.count > limit else { return }
        for entity in entities.dropFirst(limit) { context.delete(entity) }
        try? context.save()
    }

    private func reload() {
        items = fetchEntities().prefix(limit).enumerated().map { index, entity in
            WatchlistItem(
                ticker: entity.ticker, name: entity.name,
                addedAt: entity.openedAt, position: index
            )
        }
    }
}
