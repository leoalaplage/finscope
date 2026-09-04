import Foundation

/// What a payload came with: the figures, and how fresh they are.
///
/// Every repository returns this rather than a bare value, so a screen can
/// never receive data without also receiving the date it belongs to. That is
/// what makes "never present stale data as live" enforceable rather than a
/// convention.
struct Fetched<Value: Sendable>: Sendable {
    let value: Value
    let freshness: Freshness

    init(_ value: Value, freshness: Freshness) {
        self.value = value
        self.freshness = freshness
    }

    func map<Other: Sendable>(_ transform: (Value) -> Other) -> Fetched<Other> {
        Fetched<Other>(transform(value), freshness: freshness)
    }
}

/// Everything the app knows how to ask about a company.
///
/// The UI depends on this protocol and nothing below it. Whether the answer
/// came from a recorded fixture, the device's cache or `/v1` is a fact about
/// the composition root, not about any screen.
protocol CompanyRepository: Sendable {
    func search(query: String) async throws -> [CompanySearchResult]
    func summary(ticker: String) async throws -> Fetched<CompanySummary>
    func fundamentals(
        ticker: String,
        frequency: ReportingPeriod.Frequency
    ) async throws -> Fetched<FundamentalsBundle>
    func score(ticker: String) async throws -> Fetched<QualityScore>
}

/// The screener's universe.
///
/// Filtering and sorting are the server's job against a materialised index —
/// the phone must never download every company to filter on the device. The
/// filters travel down; a page of rows comes back.
protocol ScreenerRepository: Sendable {
    func page(filters: ScreenerFilters, cursor: String?) async throws -> Fetched<ScreenerPage>
}

/// How current FinScope's own reading of the filings is.
protocol DataStatusRepository: Sendable {
    func status() async throws -> Fetched<DataStatus>
}

// MARK: - Filtering shared by both repositories

/// Applies a reader's filters to already-scored rows.
///
/// This is selection, not scoring: it keeps or drops rows whose numbers were
/// decided by the engine against a fixed universe. No percentile is recomputed
/// and no rank moves, which is the property that makes the score on a fiche
/// and the score in the screener the same number.
///
/// Shared so that the fixture path and any client-side refinement of a server
/// page cannot disagree about what a filter means.
enum ScreenerFiltering {
    static func apply(_ filters: ScreenerFilters, to rows: [ScreenerRow]) -> [ScreenerRow] {
        let kept = rows.filter { row in
            if let minimum = filters.minimumScore, (row.total ?? -1) < minimum { return false }
            if !filters.grades.isEmpty, !filters.grades.contains(row.grade.raw) { return false }
            if !filters.sectors.isEmpty {
                guard let sector = row.sector, filters.sectors.contains(sector) else { return false }
            }
            if let cap = filters.minimumMarketCapBillions, (row.marketCapBillions ?? -1) < cap {
                return false
            }
            if let maximum = filters.maximumAlerts, row.alertCount > maximum { return false }
            for metric in ScreenerMetric.allCases {
                guard let bound = filters.metricBounds[metric.key] else { continue }
                // A company with no figure for a filtered metric is dropped
                // rather than kept: a filter on ROIC is a question, and a
                // company that does not answer it has not passed it.
                guard let value = row.metric(metric) else { return false }
                if metric.higherIsBetter ? value < bound : value > bound { return false }
            }
            return true
        }
        return sort(kept, by: filters.sort)
    }

    static func sort(_ rows: [ScreenerRow], by sort: ScreenerSort) -> [ScreenerRow] {
        /// Rows with no figure sort last whichever way the column runs: an
        /// unknown is not a zero and must not lead the list.
        func ordered(_ lhs: Double?, _ rhs: Double?, descending: Bool = true) -> Bool {
            switch (lhs, rhs) {
            case (nil, nil): return false
            case (nil, _): return false
            case (_, nil): return true
            case let (left?, right?): return descending ? left > right : left < right
            }
        }

        return rows.sorted { left, right in
            switch sort {
            case .score: ordered(left.total, right.total)
            case .marketCap: ordered(left.marketCapBillions, right.marketCapBillions)
            case .roic: ordered(left.metric(.roic), right.metric(.roic))
            case .revenueGrowth: ordered(left.metric(.revenueGrowth), right.metric(.revenueGrowth))
            case .fcfYield: ordered(left.metric(.fcfYield), right.metric(.fcfYield))
            }
        }
    }
}
