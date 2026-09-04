import Foundation

/// One period's figure in a series.
///
/// A point with no value is kept rather than dropped. A gap in a company's
/// history is information — it is a year the filer published nothing — and
/// silently closing it would draw a continuous line through a hole.
struct SeriesPoint: Identifiable, Hashable, Sendable {
    let periodEnd: Date
    let fiscalYear: Int?
    /// The filer's own label: "FY2025", "TTM Q3 FY2026".
    let label: String
    let value: Double?
    let status: ValueStatus
    /// Why this period has no figure. Non-nil exactly when `value` is nil.
    let reason: String?
    /// A caveat on a figure that does exist.
    let note: String?

    var id: Date { periodEnd }

    /// The compact form for a chart axis: "'25", or "Q3 '26" for a trailing
    /// window.
    ///
    /// Built from `fiscalYear`, which the contract carries, rather than by
    /// slicing the label. Scraping four characters after "FY" turned the
    /// filer's own "FY 2015" — with its space — into "'01" on every axis.
    var axisLabel: String {
        guard let fiscalYear else { return label }
        let year = fiscalYear % 100
        let short = "'" + (year < 10 ? "0\(year)" : "\(year)")
        if let quarter = label.range(of: "Q[1-4]", options: .regularExpression) {
            return "\(label[quarter]) \(short)"
        }
        return short
    }
}

/// How a series should be drawn. The rule belongs to the figure, not to the
/// screen: a flow of money over a period is a bar, a rate measured at a point
/// is a line.
enum SeriesStyle: String, Codable, Hashable, Sendable {
    case bar
    case line
}

/// One metric's history, with everything a chart needs to draw it honestly.
struct FundamentalSeries: Identifiable, Hashable, Sendable {
    let metric: String
    let label: String
    let unit: MetricUnit
    let style: SeriesStyle
    let currency: String?
    let frequency: ReportingPeriod.Frequency
    /// Whether this company published anything at all for this metric.
    let isAvailable: Bool
    /// Why the whole series is empty. Non-nil exactly when `isAvailable` is false.
    let unavailableReason: String?
    let points: [SeriesPoint]

    var id: String { metric }

    /// The points that carry a figure, oldest first.
    var plottablePoints: [SeriesPoint] {
        points.filter { $0.value != nil }
    }

    var latest: SeriesPoint? { plottablePoints.last }

    /// Whether the axis must include zero.
    ///
    /// A bar chart that starts above zero makes a 3% rise look like a doubling,
    /// so flows always include it. A rate — a margin, a return — is read
    /// against its own range and may be shown zoomed, except when it goes
    /// negative, where the sign is the whole story.
    var domainMustIncludeZero: Bool {
        if style == .bar { return true }
        return plottablePoints.contains { ($0.value ?? 0) < 0 }
    }

    /// Trims to the last `years` of periods. Presentation only — it selects
    /// from what was received and computes nothing.
    func limited(toLast years: Int?) -> FundamentalSeries {
        guard let years, points.count > years else { return self }
        return FundamentalSeries(
            metric: metric,
            label: label,
            unit: unit,
            style: style,
            currency: currency,
            frequency: frequency,
            isAvailable: isAvailable,
            unavailableReason: unavailableReason,
            points: Array(points.suffix(years))
        )
    }
}

/// The window a chart shows.
enum SeriesRange: String, CaseIterable, Identifiable, Sendable {
    case fiveYears = "5Y"
    case tenYears = "10Y"
    case max = "Max"

    var id: String { rawValue }

    /// The number of periods, or `nil` for all of them.
    func periodCount(frequency: ReportingPeriod.Frequency) -> Int? {
        let perYear: Int
        switch frequency {
        case .annual: perYear = 1
        case .ttm, .quarterly: perYear = 4
        }
        switch self {
        case .fiveYears: return 5 * perYear
        case .tenYears: return 10 * perYear
        case .max: return nil
        }
    }
}

/// Every series the fiche can chart for one company, at one frequency.
struct FundamentalsBundle: Hashable, Sendable {
    let ticker: String
    let frequency: ReportingPeriod.Frequency
    let currency: String?
    let series: [FundamentalSeries]
    let freshness: Freshness

    func series(for metric: String) -> FundamentalSeries? {
        series.first { $0.metric == metric }
    }
}

/// The sections the fiche drills into, and which metrics belong to each.
///
/// Declared here rather than in the views so that the fiche, the section
/// screens and the chart picker cannot drift apart.
enum FundamentalSection: String, CaseIterable, Identifiable, Sendable {
    case growth
    case profitability
    case cashFlow
    case balanceSheet
    case valuation

    var id: String { rawValue }

    var label: String {
        switch self {
        case .growth: "Growth"
        case .profitability: "Profitability"
        case .cashFlow: "Cash Flow"
        case .balanceSheet: "Balance Sheet"
        case .valuation: "Valuation"
        }
    }

    var systemImage: String {
        switch self {
        case .growth: "arrow.up.right"
        case .profitability: "percent"
        case .cashFlow: "arrow.left.arrow.right"
        case .balanceSheet: "scalemass"
        case .valuation: "tag"
        }
    }

    /// The metric keys this section shows, in order.
    var metrics: [String] {
        switch self {
        case .growth: ["revenue", "netIncome", "dilutedEpsReported"]
        case .profitability: ["grossMargin", "operatingMargin", "roic"]
        case .cashFlow: ["freeCashFlow", "freeCashFlowMargin", "freeCashFlowPerShare"]
        case .balanceSheet: ["totalDebt", "netDebt", "dilutedShares"]
        case .valuation: ["freeCashFlowPerShare", "dilutedEpsReported"]
        }
    }
}
