import Foundation

/// A company as the app knows it. Identity only — no figures live here, so
/// nothing on this type can go stale.
struct Company: Hashable, Sendable, Identifiable {
    let ticker: String
    let name: String
    let cik: String?
    let exchange: String?
    let sector: String?
    let currency: String?
    /// The engine's word for the business: "operating company", "exchange",
    /// "bank". It decides which metrics are meaningful, so the app shows it
    /// rather than quietly dropping the metrics it rules out.
    let businessTypeLabel: String?
    /// True when industrial measures — ROIC, free cash flow, net debt — do not
    /// describe this business. Never used to hide a metric silently; used to
    /// explain why one is missing.
    let isFinancial: Bool
    let regulatoryId: String?
    let summary: String?

    var id: String { ticker }
}

/// A search result: enough to show a row and open a fiche, nothing more.
struct CompanySearchResult: Hashable, Sendable, Identifiable {
    let ticker: String
    let name: String
    let exchange: String?
    let sector: String?
    /// Whether FinScope holds a built dataset for this company. An uncovered
    /// company is still openable; it just has to be built first, and the row
    /// says so instead of pretending otherwise.
    let isCovered: Bool

    var id: String { ticker }
}

/// The last matched close, with the date it is from.
///
/// `asOf` is not optional decoration: a price without its date is the one thing
/// that turns a cached figure into a lie.
struct Price: Hashable, Sendable {
    let value: Double
    let currency: String
    let asOf: Date
    let previousClose: Double?
    /// The day's move in percentage points. `nil` when there is no prior close
    /// to measure against, rather than zero.
    let changePercent: Double?
    /// "split-adjusted close" — what kind of price this is.
    let kind: String?
    let sourceURL: URL?
}

/// The accounting period a set of figures describes.
struct ReportingPeriod: Hashable, Sendable {
    /// "TTM Q3 FY2026" — the filer's own vocabulary.
    let label: String
    let end: Date
    let frequency: Frequency
    let currency: String?

    enum Frequency: String, Codable, Hashable, Sendable, CaseIterable {
        case annual
        case quarterly
        case ttm

        /// Shown on the frequency toggle. Deliberately the short form: it sits
        /// beside a range picker and competes with it for width.
        var shortLabel: String {
            switch self {
            case .annual: "Annual"
            case .quarterly: "Quarterly"
            case .ttm: "TTM"
            }
        }
    }
}

/// The fiche's summary: who the company is, what it costs, how it scores, and
/// the four figures worth seeing before scrolling.
struct CompanySummary: Hashable, Sendable {
    let company: Company
    let price: Price?
    let period: ReportingPeriod?
    let score: ScoreSummary?
    let keyMetrics: [NamedMetric]
    /// Caveats the backend attached to this company's figures. Shown, not
    /// swallowed: they are how a reader learns that a quarter was derived.
    let warnings: [String]
    let freshness: Freshness
}
