import Foundation

/// One line of the screener.
struct ScreenerRow: Identifiable, Hashable, Sendable {
    let ticker: String
    let name: String
    let sector: String?
    let total: Double?
    let grade: ScoreGrade
    let coverage: Double
    let pillars: [ScorePillar: Double?]
    let alertCount: Int
    /// Billions, as the engine's own column states it.
    let marketCapBillions: Double?
    /// The filterable figures, keyed by `ScreenerMetric.key`.
    let metrics: [String: Double?]

    var id: String { ticker }

    func metric(_ metric: ScreenerMetric) -> Double? {
        metrics[metric.key] ?? nil
    }
}

/// A figure the screener can sort and filter on.
///
/// The list is deliberately short and matches what the materialized universe
/// actually carries. A control for a column the backend does not publish would
/// be a promise the product cannot keep.
enum ScreenerMetric: String, CaseIterable, Identifiable, Sendable {
    case roic
    case revenueGrowth
    case fcfGrowth
    case operatingMargin
    case fcfMargin
    case netDebtToEbitda
    case evToFcf
    case fcfYield

    var id: String { rawValue }
    var key: String { rawValue }

    var label: String {
        switch self {
        case .roic: "ROIC"
        case .revenueGrowth: "Revenue growth"
        case .fcfGrowth: "FCF growth"
        case .operatingMargin: "Operating margin"
        case .fcfMargin: "FCF margin"
        case .netDebtToEbitda: "Net debt / EBITDA"
        case .evToFcf: "EV / FCF"
        case .fcfYield: "FCF yield"
        }
    }

    /// The short form for a list row, where two of these share a line.
    var compactLabel: String {
        switch self {
        case .roic: "ROIC"
        case .revenueGrowth: "Rev 5Y"
        case .fcfGrowth: "FCF 5Y"
        case .operatingMargin: "Op margin"
        case .fcfMargin: "FCF margin"
        case .netDebtToEbitda: "ND/EBITDA"
        case .evToFcf: "EV/FCF"
        case .fcfYield: "FCF yield"
        }
    }

    var unit: MetricUnit {
        switch self {
        case .roic, .revenueGrowth, .fcfGrowth, .operatingMargin, .fcfMargin, .fcfYield: .percent
        case .netDebtToEbitda, .evToFcf: .ratio
        }
    }

    var section: FilterSection {
        switch self {
        case .revenueGrowth, .fcfGrowth: .growth
        case .roic, .operatingMargin, .fcfMargin: .profitability
        case .netDebtToEbitda: .balanceSheet
        case .evToFcf, .fcfYield: .valuation
        }
    }

    /// Whether a bigger figure is a better one. Decides which end of a filter
    /// is a floor and which is a ceiling.
    var higherIsBetter: Bool {
        switch self {
        case .netDebtToEbitda, .evToFcf: false
        default: true
        }
    }
}

/// The sections of the filter sheet.
enum FilterSection: String, CaseIterable, Identifiable, Sendable {
    case score
    case size
    case growth
    case profitability
    case balanceSheet
    case valuation
    case sector

    var id: String { rawValue }

    var label: String {
        switch self {
        case .score: "Score"
        case .size: "Size"
        case .growth: "Growth"
        case .profitability: "Profitability"
        case .balanceSheet: "Balance Sheet"
        case .valuation: "Valuation"
        case .sector: "Sector"
        }
    }
}

/// How the list is ordered. The sort also decides which two metrics each row
/// shows, so that the column you sorted by is the one you can see.
enum ScreenerSort: String, CaseIterable, Identifiable, Sendable {
    case score
    case marketCap
    case roic
    case revenueGrowth
    case fcfYield

    var id: String { rawValue }

    var label: String {
        switch self {
        case .score: "Quality Score"
        case .marketCap: "Market cap"
        case .roic: "ROIC"
        case .revenueGrowth: "Revenue growth"
        case .fcfYield: "FCF yield"
        }
    }

    /// The two figures a row shows under this sort.
    var rowMetrics: [ScreenerMetric] {
        switch self {
        case .score, .marketCap: [.roic, .fcfGrowth]
        case .roic: [.roic, .operatingMargin]
        case .revenueGrowth: [.revenueGrowth, .fcfGrowth]
        case .fcfYield: [.fcfYield, .evToFcf]
        }
    }
}

/// The filters a reader has set. Value type, so a sheet can edit a copy and
/// the list only reloads when it is applied.
struct ScreenerFilters: Hashable, Sendable {
    var minimumScore: Double?
    var grades: Set<String> = []
    var sectors: Set<String> = []
    var minimumMarketCapBillions: Double?
    var maximumAlerts: Int?
    /// Floors for metrics where more is better, ceilings for the rest.
    var metricBounds: [String: Double] = [:]
    var sort: ScreenerSort = .score

    static let none = ScreenerFilters()

    var isEmpty: Bool {
        minimumScore == nil
            && grades.isEmpty
            && sectors.isEmpty
            && minimumMarketCapBillions == nil
            && maximumAlerts == nil
            && metricBounds.isEmpty
    }

    /// The active filters as chips, in a stable order.
    var chips: [FilterChip] {
        var chips: [FilterChip] = []
        if let minimumScore {
            chips.append(FilterChip(id: "score", label: "Score ≥ \(Int(minimumScore))"))
        }
        for grade in grades.sorted() {
            chips.append(FilterChip(id: "grade.\(grade)", label: grade))
        }
        if let cap = minimumMarketCapBillions {
            chips.append(FilterChip(id: "cap", label: "Cap ≥ $\(Int(cap))bn"))
        }
        if let maximumAlerts {
            chips.append(FilterChip(id: "alerts", label: "≤ \(maximumAlerts) alert\(maximumAlerts == 1 ? "" : "s")"))
        }
        for metric in ScreenerMetric.allCases {
            guard let bound = metricBounds[metric.key] else { continue }
            let comparison = metric.higherIsBetter ? "≥" : "≤"
            chips.append(
                FilterChip(
                    id: "metric.\(metric.key)",
                    label: "\(metric.compactLabel) \(comparison) \(Formatter.filterBound(bound, unit: metric.unit))"
                )
            )
        }
        for sector in sectors.sorted() {
            chips.append(FilterChip(id: "sector.\(sector)", label: sector))
        }
        return chips
    }

    /// Removes the filter a chip stands for.
    mutating func remove(chip: FilterChip) {
        let parts = chip.id.split(separator: ".", maxSplits: 1).map(String.init)
        switch parts.first {
        case "score": minimumScore = nil
        case "cap": minimumMarketCapBillions = nil
        case "alerts": maximumAlerts = nil
        case "grade": if parts.count > 1 { grades.remove(parts[1]) }
        case "sector": if parts.count > 1 { sectors.remove(parts[1]) }
        case "metric": if parts.count > 1 { metricBounds[parts[1]] = nil }
        default: break
        }
    }
}

struct FilterChip: Identifiable, Hashable, Sendable {
    let id: String
    let label: String
}

/// A page of screener results, with the versions that make the scores comparable.
struct ScreenerPage: Hashable, Sendable {
    let rows: [ScreenerRow]
    let scoreVersion: String
    let universeVersion: String
    let universeLabel: String
    let universeSize: Int
    /// Metrics no company in the universe carried, so no filter can use them.
    let unavailableMetrics: [String]
    let warnings: [String]
    let cursor: String?
    let freshness: Freshness

    /// The sectors present, for the filter sheet.
    var sectors: [String] {
        Array(Set(rows.compactMap(\.sector))).sorted()
    }
}
