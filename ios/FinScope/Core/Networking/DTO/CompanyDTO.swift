import Foundation

// The wire shape of `/v1`, exactly as AUDIT_FINSCOPE_IOS.md §5.5 specifies it
// and as `ios/Tools/record-fixtures.mjs` writes it. These types are the only
// place in the app that knows what the JSON looks like; everything above them
// speaks in domain types, so a contract change stops here.

/// A figure and its status, as the contract carries it.
struct MetricValueDTO: Decodable, Sendable {
    let value: Double?
    let status: String
    let unit: String
    let currency: String?
    let reason: String?
    let basis: String?

    var domain: MetricValue {
        MetricValue(
            value: value,
            status: ValueStatus(rawValue: status) ?? (value == nil ? .unavailable : .calculated),
            unit: MetricUnit(rawValue: unit) ?? .ratio,
            currency: currency,
            // A missing figure with no stated reason is a contract violation,
            // not a blank to render silently. Saying so is better than
            // inventing an explanation the backend did not give.
            reason: value == nil ? (reason ?? "No reason was given for this gap.") : nil,
            basis: basis
        )
    }
}

struct KeyMetricDTO: Decodable, Sendable {
    let key: String
    let label: String
    let detail: String?
    let value: Double?
    let status: String
    let unit: String
    let currency: String?
    let reason: String?
    let basis: String?

    var domain: NamedMetric {
        NamedMetric(
            key: key,
            label: label,
            detail: detail,
            metric: MetricValueDTO(
                value: value, status: status, unit: unit,
                currency: currency, reason: reason, basis: basis
            ).domain
        )
    }
}

struct CompanyDTO: Decodable, Sendable {
    let ticker: String
    let name: String
    let cik: String?
    let exchange: String?
    let sector: String?
    let currency: String?
    let businessType: String?
    let businessTypeLabel: String?
    let isFinancial: Bool?
    let regulatoryId: String?
    let description: String?

    var domain: Company {
        Company(
            ticker: ticker,
            name: name,
            cik: cik,
            exchange: exchange,
            sector: sector,
            currency: currency,
            businessTypeLabel: businessTypeLabel,
            isFinancial: isFinancial ?? false,
            regulatoryId: regulatoryId,
            summary: description
        )
    }
}

struct PriceDTO: Decodable, Sendable {
    let value: Double
    let previousClose: Double?
    let changePercent: Double?
    let currency: String
    let asOf: Date
    let type: String?
    let sourceUrl: String?

    var domain: Price {
        Price(
            value: value,
            currency: currency,
            asOf: asOf,
            previousClose: previousClose,
            changePercent: changePercent,
            kind: type,
            sourceURL: sourceUrl.flatMap(URL.init(string:))
        )
    }
}

struct PeriodDTO: Decodable, Sendable {
    let label: String
    let end: Date
    let frequency: String
    let currency: String?

    var domain: ReportingPeriod {
        ReportingPeriod(
            label: label,
            end: end,
            frequency: ReportingPeriod.Frequency(rawValue: frequency) ?? .annual,
            currency: currency
        )
    }
}

struct ScoreSummaryDTO: Decodable, Sendable {
    let total: Double?
    let grade: String
    let coverage: Double
    let scoreVersion: String
    let universeVersion: String
    let universeSize: Int
    let pillars: [String: Double?]

    var domain: ScoreSummary {
        ScoreSummary(
            total: total,
            grade: ScoreGrade(raw: grade),
            coverage: coverage,
            pillars: ScorePillar.dictionary(from: pillars),
            scoreVersion: scoreVersion,
            universeVersion: universeVersion,
            universeSize: universeSize
        )
    }
}

struct CompanySummaryDTO: Decodable, Sendable {
    let schemaVersion: String
    let dataVersion: String?
    let company: CompanyDTO
    let price: PriceDTO?
    let period: PeriodDTO?
    let score: ScoreSummaryDTO?
    let keyMetrics: [KeyMetricDTO]
    let asOf: Date?
    let retrievedAt: Date?
    let warnings: [String]?

    var domain: CompanySummary {
        CompanySummary(
            company: company.domain,
            price: price?.domain,
            period: period?.domain,
            score: score?.domain,
            keyMetrics: keyMetrics.map(\.domain),
            warnings: warnings ?? [],
            freshness: Freshness(asOf: asOf, retrievedAt: retrievedAt, dataVersion: dataVersion)
        )
    }
}

struct SearchResultDTO: Decodable, Sendable {
    let ticker: String
    let name: String
    let exchange: String?
    let sector: String?
    let currency: String?
    let cik: String?
    let covered: Bool?

    var domain: CompanySearchResult {
        CompanySearchResult(
            ticker: ticker,
            name: name,
            exchange: exchange,
            sector: sector,
            isCovered: covered ?? false
        )
    }
}

struct SearchResponseDTO: Decodable, Sendable {
    let schemaVersion: String
    let retrievedAt: Date?
    let results: [SearchResultDTO]
}

extension ScorePillar {
    /// Maps the contract's pillar keys onto the enum, dropping any the app does
    /// not know. A new pillar server-side is a new build client-side, not a
    /// silent miscount.
    static func dictionary(from raw: [String: Double?]) -> [ScorePillar: Double?] {
        var pillars: [ScorePillar: Double?] = [:]
        for pillar in ScorePillar.allCases {
            pillars[pillar] = raw[pillar.rawValue] ?? nil
        }
        return pillars
    }
}
