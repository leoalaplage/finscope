import Foundation
import SwiftData

/// What a cache lookup found.
struct CachedPayload: Sendable {
    let data: Data
    let etag: String?
    let retrievedAt: Date
    let version: String?
}

/// The persistent response cache: bytes on disk, index in SwiftData.
///
/// Split that way on purpose. The payloads are tens to hundreds of kilobytes
/// of JSON and belong in files; what SwiftData holds is the row that makes a
/// file findable, datable and evictable — key, ticker, endpoint, version,
/// ETag, timestamp, path.
///
/// The cache never decides that a copy is current. It hands back what it has
/// with the date it was read, and the repository above it decides whether that
/// is worth showing while a refresh runs.
@ModelActor
actor ResponseCache {

    /// The ceiling before least-recently-used files are dropped. Generous
    /// enough for a serious watchlist, small enough that the app is not a
    /// storage problem on a full phone.
    static let byteBudget = 80 * 1_024 * 1_024

    private static var directory: URL {
        let base = URL.applicationSupportDirectory.appending(path: "cache", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base
    }

    /// The copy held for a key, if the version it was built under still stands.
    ///
    /// A payload from an older `dataVersion` is not stale, it is *wrong*: the
    /// figures were normalised under different rules. It is dropped rather
    /// than shown with an apology.
    func payload(for key: String, acceptingVersion version: String? = nil) -> CachedPayload? {
        guard let entry = entry(for: key) else { return nil }
        if let version, let stored = entry.version, stored != version {
            remove(entry)
            return nil
        }
        let url = Self.directory.appending(path: entry.path)
        guard let data = try? Data(contentsOf: url) else {
            remove(entry)
            return nil
        }
        entry.lastAccessedAt = .now
        try? modelContext.save()
        return CachedPayload(
            data: data,
            etag: entry.etag,
            retrievedAt: entry.retrievedAt,
            version: entry.version
        )
    }

    /// Stores a response, replacing any earlier copy for the same key.
    func store(
        _ data: Data,
        for key: String,
        ticker: String?,
        endpoint: String,
        version: String?,
        etag: String?,
        retrievedAt: Date = .now
    ) {
        let filename = "\(Self.filename(for: key)).json"
        let url = Self.directory.appending(path: filename)
        do {
            try data.write(to: url, options: .atomic)
        } catch {
            return
        }

        if let existing = entry(for: key) {
            existing.version = version
            existing.etag = etag
            existing.retrievedAt = retrievedAt
            existing.lastAccessedAt = retrievedAt
            existing.path = filename
            existing.byteCount = data.count
        } else {
            modelContext.insert(
                CachedResponseEntity(
                    key: key, ticker: ticker, endpoint: endpoint, version: version,
                    etag: etag, retrievedAt: retrievedAt, path: filename, byteCount: data.count
                )
            )
        }
        try? modelContext.save()
        evictIfNeeded()
    }

    /// Refreshes the timestamp when the server answers 304: the bytes did not
    /// change, but our knowledge that they are current did.
    func touch(key: String, at date: Date = .now) {
        guard let entry = entry(for: key) else { return }
        entry.retrievedAt = date
        entry.lastAccessedAt = date
        try? modelContext.save()
    }

    /// Total bytes held, for the Settings screen.
    func currentByteCount() -> Int {
        let entries = (try? modelContext.fetch(FetchDescriptor<CachedResponseEntity>())) ?? []
        return entries.reduce(0) { $0 + $1.byteCount }
    }

    /// Empties the cache. User data is in different tables and is untouched.
    func removeAll() {
        let entries = (try? modelContext.fetch(FetchDescriptor<CachedResponseEntity>())) ?? []
        for entry in entries { remove(entry) }
        try? modelContext.save()
    }

    // MARK: - Private

    private func entry(for key: String) -> CachedResponseEntity? {
        var descriptor = FetchDescriptor<CachedResponseEntity>(
            predicate: #Predicate { $0.key == key }
        )
        descriptor.fetchLimit = 1
        return try? modelContext.fetch(descriptor).first
    }

    private func remove(_ entry: CachedResponseEntity) {
        try? FileManager.default.removeItem(at: Self.directory.appending(path: entry.path))
        modelContext.delete(entry)
    }

    private func evictIfNeeded() {
        var entries = (try? modelContext.fetch(
            FetchDescriptor<CachedResponseEntity>(
                sortBy: [SortDescriptor(\.lastAccessedAt, order: .forward)]
            )
        )) ?? []
        var total = entries.reduce(0) { $0 + $1.byteCount }
        while total > Self.byteBudget, let oldest = entries.first {
            total -= oldest.byteCount
            remove(oldest)
            entries.removeFirst()
        }
        try? modelContext.save()
    }

    /// A filesystem-safe name for a key like "companies/AAPL/summary".
    private static func filename(for key: String) -> String {
        key.map { character in
            character.isLetter || character.isNumber || character == "-" ? character : "_"
        }
        .reduce(into: "") { $0.append($1) }
    }
}
