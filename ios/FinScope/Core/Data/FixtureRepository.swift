import Foundation

/// Reads the recorded `/v1` contract out of the app bundle.
///
/// Every figure it returns was produced by FinScope's own engine and recorded
/// by `ios/Tools/record-fixtures.mjs` — the datasets come from the deployed
/// Worker, the metrics from `lib/finance.ts`, the scores from `lib/qs/*`. None
/// of it is invented, which is why the app can be built and judged before
/// `/v1` answers.
///
/// When Codex's `contracts/v1` lands, the JSON under `Resources/Fixtures/v1`
/// is replaced and nothing else moves.
struct FixtureRepository: CompanyRepository, ScreenerRepository, DataStatusRepository {

    /// The directory inside the bundle, mirroring `contracts/v1`.
    private let root: String
    private let bundle: Bundle
    /// A deliberate pause so loading states are exercised rather than skipped.
    /// Zero in tests.
    private let latency: Duration

    init(bundle: Bundle = .main, root: String = "Fixtures/v1", latency: Duration = .milliseconds(120)) {
        self.bundle = bundle
        self.root = root
        self.latency = latency
    }

    // MARK: - CompanyRepository

    func search(query: String) async throws -> [CompanySearchResult] {
        try await pause()
        let response: SearchResponseDTO = try load("search")
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return [] }
        // The fixture holds the covered universe and matches here; the live
        // endpoint matches server-side against the SEC registry. The screen
        // above cannot tell, which is the point of the seam.
        return response.results
            .map(\.domain)
            .filter { $0.ticker.lowercased().hasPrefix(needle) || $0.name.lowercased().contains(needle) }
            .sorted { left, right in
                let leftExact = left.ticker.lowercased() == needle
                let rightExact = right.ticker.lowercased() == needle
                if leftExact != rightExact { return leftExact }
                return left.ticker < right.ticker
            }
    }

    func summary(ticker: String) async throws -> Fetched<CompanySummary> {
        try await pause()
        let dto: CompanySummaryDTO = try load("companies/\(ticker.uppercased())/summary", ticker: ticker)
        let summary = dto.domain
        return Fetched(summary, freshness: summary.freshness)
    }

    func fundamentals(
        ticker: String,
        frequency: ReportingPeriod.Frequency
    ) async throws -> Fetched<FundamentalsBundle> {
        try await pause()
        let dto: FundamentalsDTO = try load(
            "companies/\(ticker.uppercased())/fundamentals-\(frequency.rawValue)",
            ticker: ticker
        )
        let bundle = dto.domain
        return Fetched(bundle, freshness: bundle.freshness)
    }

    func score(ticker: String) async throws -> Fetched<QualityScore> {
        try await pause()
        let dto: QualityScoreDTO = try load("companies/\(ticker.uppercased())/score", ticker: ticker)
        let score = dto.domain
        return Fetched(score, freshness: score.freshness)
    }

    // MARK: - ScreenerRepository

    func page(filters: ScreenerFilters, cursor: String?) async throws -> Fetched<ScreenerPage> {
        try await pause()
        let dto: ScreenerResponseDTO = try load("screener")
        let page = dto.domain
        let filtered = ScreenerFiltering.apply(filters, to: page.rows)
        return Fetched(
            ScreenerPage(
                rows: filtered,
                scoreVersion: page.scoreVersion,
                universeVersion: page.universeVersion,
                universeLabel: page.universeLabel,
                universeSize: page.universeSize,
                unavailableMetrics: page.unavailableMetrics,
                warnings: page.warnings,
                cursor: nil,
                freshness: page.freshness
            ),
            freshness: page.freshness
        )
    }

    // MARK: - DataStatusRepository

    func status() async throws -> Fetched<DataStatus> {
        try await pause()
        let dto: DataStatusDTO = try load("data-status")
        let status = dto.domain
        return Fetched(status, freshness: status.freshness)
    }

    // MARK: - Private

    private func pause() async throws {
        guard latency > .zero else { return }
        do {
            try await Task.sleep(for: latency)
        } catch {
            throw FinScopeError.cancelled
        }
    }

    private func load<Value: Decodable>(_ path: String, ticker: String? = nil) throws -> Value {
        let directory = (path as NSString).deletingLastPathComponent
        let name = (path as NSString).lastPathComponent
        let subdirectory = directory.isEmpty ? root : "\(root)/\(directory)"

        guard let url = bundle.url(forResource: name, withExtension: "json", subdirectory: subdirectory) else {
            // A company outside the recorded set is genuinely not held — the
            // same answer the live backend gives, so the screen above needs no
            // special case for running on fixtures.
            throw FinScopeError.notFound(ticker ?? name)
        }
        do {
            return try APIClient.decoder.decode(Value.self, from: try Data(contentsOf: url))
        } catch let error as DecodingError {
            throw FinScopeError.decoding(APIClient.describe(error))
        } catch {
            throw FinScopeError.decoding(error.localizedDescription)
        }
    }
}
