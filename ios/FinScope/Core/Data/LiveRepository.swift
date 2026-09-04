import Foundation

/// Reads `/v1`, cache first.
///
/// The policy is one sentence: hand back what is on the device immediately if
/// there is any, then ask the network and replace it. That is why a fiche
/// opens instantly on the second visit and why losing a connection does not
/// empty a screen. What the policy never does is let the cached copy pass for
/// a live one — every value comes back inside a `Fetched` carrying the date it
/// was read and whether it came off disk.
///
/// `/v1` does not answer yet; Codex owns it. This type is written against the
/// contract the fixtures record, so switching the composition root over is a
/// one-line change once the endpoints exist.
struct LiveRepository: CompanyRepository, ScreenerRepository, DataStatusRepository {
    private let api: APIClient
    private let cache: ResponseCache?

    init(api: APIClient, cache: ResponseCache?) {
        self.api = api
        self.cache = cache
    }

    // MARK: - CompanyRepository

    /// Search is never served from cache: a stale answer to a query the reader
    /// is typing right now is worse than a spinner.
    func search(query: String) async throws -> [CompanySearchResult] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }
        let response = try await api.get(
            "companies/search",
            query: [URLQueryItem(name: "q", value: trimmed)],
            as: SearchResponseDTO.self
        )
        return response?.value.results.map(\.domain) ?? []
    }

    func summary(ticker: String) async throws -> Fetched<CompanySummary> {
        let ticker = ticker.uppercased()
        return try await fetch(
            key: "companies/\(ticker)/summary",
            path: "companies/\(ticker)/summary",
            endpoint: "summary",
            ticker: ticker,
            as: CompanySummaryDTO.self
        ) { dto, freshness in
            Fetched(dto.domain, freshness: freshness)
        }
    }

    func fundamentals(
        ticker: String,
        frequency: ReportingPeriod.Frequency
    ) async throws -> Fetched<FundamentalsBundle> {
        let ticker = ticker.uppercased()
        return try await fetch(
            key: "companies/\(ticker)/fundamentals/\(frequency.rawValue)",
            path: "companies/\(ticker)/fundamentals",
            query: [URLQueryItem(name: "frequency", value: frequency.rawValue)],
            endpoint: "fundamentals",
            ticker: ticker,
            as: FundamentalsDTO.self
        ) { dto, freshness in
            Fetched(dto.domain, freshness: freshness)
        }
    }

    func score(ticker: String) async throws -> Fetched<QualityScore> {
        let ticker = ticker.uppercased()
        return try await fetch(
            key: "companies/\(ticker)/score",
            path: "companies/\(ticker)/score",
            endpoint: "score",
            ticker: ticker,
            as: QualityScoreDTO.self
        ) { dto, freshness in
            Fetched(dto.domain, freshness: freshness)
        }
    }

    // MARK: - ScreenerRepository

    /// Filters and sort go to the server, which runs them against the
    /// materialised index. The phone never downloads the universe to filter it.
    func page(filters: ScreenerFilters, cursor: String?) async throws -> Fetched<ScreenerPage> {
        var query: [URLQueryItem] = [URLQueryItem(name: "sort", value: filters.sort.rawValue)]
        if let minimum = filters.minimumScore {
            query.append(URLQueryItem(name: "minScore", value: String(Int(minimum))))
        }
        if let cap = filters.minimumMarketCapBillions {
            query.append(URLQueryItem(name: "minMarketCap", value: String(Int(cap))))
        }
        if let alerts = filters.maximumAlerts {
            query.append(URLQueryItem(name: "maxAlerts", value: String(alerts)))
        }
        if !filters.grades.isEmpty {
            query.append(URLQueryItem(name: "grades", value: filters.grades.sorted().joined(separator: ",")))
        }
        if !filters.sectors.isEmpty {
            query.append(URLQueryItem(name: "sectors", value: filters.sectors.sorted().joined(separator: ",")))
        }
        for metric in ScreenerMetric.allCases {
            guard let bound = filters.metricBounds[metric.key] else { continue }
            let name = metric.higherIsBetter ? "min\(metric.key.capitalizedFirst)" : "max\(metric.key.capitalizedFirst)"
            query.append(URLQueryItem(name: name, value: String(bound)))
        }
        if let cursor { query.append(URLQueryItem(name: "cursor", value: cursor)) }

        // Only the first page is cached. A deep page under one particular set
        // of filters is not what an offline reader wants back.
        let cacheKey = cursor == nil && filters.isEmpty ? "screener/default" : nil
        return try await fetch(
            key: cacheKey,
            path: "screener",
            query: query,
            endpoint: "screener",
            ticker: nil,
            as: ScreenerResponseDTO.self
        ) { dto, freshness in
            Fetched(dto.domain, freshness: freshness)
        }
    }

    // MARK: - DataStatusRepository

    func status() async throws -> Fetched<DataStatus> {
        try await fetch(
            key: "data-status",
            path: "data-status",
            endpoint: "status",
            ticker: nil,
            as: DataStatusDTO.self
        ) { dto, freshness in
            Fetched(dto.domain, freshness: freshness)
        }
    }

    // MARK: - Private

    /// Cache-first, network-refresh, in one place.
    ///
    /// The order matters. The cached copy is read first so that a failure
    /// downstream still has something to return; the network answer replaces
    /// it; a 304 means the copy stands and only its read-date moves. A network
    /// failure with a cached copy in hand is not an error — it is a dated
    /// answer, and the `Freshness` says which.
    private func fetch<DTO: Decodable & Sendable, Value: Sendable>(
        key: String?,
        path: String,
        query: [URLQueryItem] = [],
        endpoint: String,
        ticker: String?,
        as type: DTO.Type,
        map: (DTO, Freshness) -> Fetched<Value>
    ) async throws -> Fetched<Value> {
        var cached: CachedPayload?
        if let key, let cache { cached = await cache.payload(for: key) }

        do {
            let response = try await api.get(
                path, query: query, etag: cached?.etag, ticker: ticker, as: DTO.self
            )

            guard let response else {
                // 304: what we hold is current. Its read-date moves; its
                // figures do not, so it is not marked as coming off disk.
                guard let cached, let key else { throw FinScopeError.network }
                await cache?.touch(key: key)
                return map(
                    try decode(DTO.self, from: cached.data),
                    Freshness(asOf: nil, retrievedAt: .now, dataVersion: cached.version)
                )
            }

            if let key, let cache {
                await cache.store(
                    response.body,
                    for: key,
                    ticker: ticker,
                    endpoint: endpoint,
                    version: response.version,
                    etag: response.etag
                )
            }
            return map(
                response.value,
                Freshness(asOf: nil, retrievedAt: .now, dataVersion: response.version)
            )
        } catch let error as FinScopeError {
            guard error != .cancelled, let cached else { throw error }
            // The network failed and there is a copy. Return it, dated and
            // marked as saved, rather than emptying a screen the reader is on.
            return map(
                try decode(DTO.self, from: cached.data),
                Freshness(
                    asOf: nil,
                    retrievedAt: cached.retrievedAt,
                    dataVersion: cached.version,
                    isFromCache: true
                )
            )
        }
    }

    private func decode<Value: Decodable>(_ type: Value.Type, from data: Data) throws -> Value {
        do {
            return try APIClient.decoder.decode(Value.self, from: data)
        } catch let error as DecodingError {
            throw FinScopeError.decoding(APIClient.describe(error))
        }
    }
}

private extension String {
    var capitalizedFirst: String {
        guard let first else { return self }
        return first.uppercased() + dropFirst()
    }
}
