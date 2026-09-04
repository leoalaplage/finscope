import Foundation
import SwiftData

/// What the app keeps on the device.
///
/// Two kinds of thing live here and only two: the reader's own decisions —
/// what they follow, what they searched — and the *index* of the response
/// cache. Financial figures are not entities. A period with forty facts, each
/// carrying its provenance, would become a schema nobody can migrate and a
/// second source of truth nobody can reconcile; the payloads stay as files and
/// SwiftData holds the key, the version and the path to them.
@Model
final class WatchlistEntity {
    #Index<WatchlistEntity>([\.ticker])
    #Unique<WatchlistEntity>([\.ticker])

    var ticker: String = ""
    var name: String = ""
    var addedAt: Date = Date.distantPast
    /// The reader's own order, which is not the order of anything else.
    var position: Int = 0

    init(ticker: String, name: String, addedAt: Date = .now, position: Int) {
        self.ticker = ticker
        self.name = name
        self.addedAt = addedAt
        self.position = position
    }
}

@Model
final class RecentSearchEntity {
    #Unique<RecentSearchEntity>([\.ticker])

    var ticker: String = ""
    var name: String = ""
    var openedAt: Date = Date.distantPast

    init(ticker: String, name: String, openedAt: Date = .now) {
        self.ticker = ticker
        self.name = name
        self.openedAt = openedAt
    }
}

/// The index of a cached response. The bytes are in `Application Support/cache`;
/// this row is how they are found, dated and evicted.
@Model
final class CachedResponseEntity {
    #Unique<CachedResponseEntity>([\.key])

    /// The request this answers: "companies/AAPL/summary".
    var key: String = ""
    var ticker: String?
    /// The endpoint family, so a contract change can evict one kind at a time.
    var endpoint: String = ""
    /// The `dataVersion` or `scoreVersion` the payload was built under. A
    /// version change makes the copy unservable, not merely old.
    var version: String?
    var etag: String?
    var retrievedAt: Date = Date.distantPast
    /// Filename inside the cache directory. Relative, so the container can move.
    var path: String = ""
    var byteCount: Int = 0
    /// Last read, for eviction. The watchlist is never evicted; this is.
    var lastAccessedAt: Date = Date.distantPast

    init(
        key: String,
        ticker: String?,
        endpoint: String,
        version: String?,
        etag: String?,
        retrievedAt: Date,
        path: String,
        byteCount: Int
    ) {
        self.key = key
        self.ticker = ticker
        self.endpoint = endpoint
        self.version = version
        self.etag = etag
        self.retrievedAt = retrievedAt
        self.path = path
        self.byteCount = byteCount
        self.lastAccessedAt = retrievedAt
    }
}

enum SchemaV1: VersionedSchema {
    static let versionIdentifier = Schema.Version(1, 0, 0)
    static var models: [any PersistentModel.Type] {
        [WatchlistEntity.self, RecentSearchEntity.self, CachedResponseEntity.self]
    }
}

enum FinScopeMigrationPlan: SchemaMigrationPlan {
    static var schemas: [any VersionedSchema.Type] { [SchemaV1.self] }
    static var stages: [MigrationStage] { [] }
}

enum FinScopeModelContainer {
    /// The app's store. `inMemory` is what every test and preview uses, so no
    /// test can leave state behind for the next one.
    ///
    /// Each in-memory store gets its own name so two of them alive at once —
    /// a canvas rendering several previews, a suite of tests — hold separate
    /// rows rather than one shared set. One preview's seeded watchlist showing
    /// up in the next one is the failure this prevents.
    static func make(inMemory: Bool = false) throws -> ModelContainer {
        let schema = Schema(versionedSchema: SchemaV1.self)
        let configuration = inMemory
            ? ModelConfiguration(UUID().uuidString, schema: schema, isStoredInMemoryOnly: true)
            : ModelConfiguration(schema: schema, isStoredInMemoryOnly: false)
        return try ModelContainer(
            for: schema,
            migrationPlan: FinScopeMigrationPlan.self,
            configurations: configuration
        )
    }
}
