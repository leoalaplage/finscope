import Foundation

struct SeriesPointDTO: Decodable, Sendable {
    let periodEnd: Date
    let fiscalYear: Int?
    let label: String
    let value: Double?
    let status: String
    let reason: String?
    let note: String?

    var domain: SeriesPoint {
        SeriesPoint(
            periodEnd: periodEnd,
            fiscalYear: fiscalYear,
            label: label,
            value: value,
            status: ValueStatus(rawValue: status) ?? (value == nil ? .unavailable : .calculated),
            reason: value == nil ? (reason ?? "No reason was given for this gap.") : nil,
            note: note
        )
    }
}

struct FundamentalSeriesDTO: Decodable, Sendable {
    let metric: String
    let label: String
    let unit: String
    let style: String
    let currency: String?
    let available: Bool
    let unavailableReason: String?
    let points: [SeriesPointDTO]

    func domain(frequency: ReportingPeriod.Frequency) -> FundamentalSeries {
        FundamentalSeries(
            metric: metric,
            label: label,
            unit: MetricUnit(rawValue: unit) ?? .ratio,
            style: SeriesStyle(rawValue: style) ?? .line,
            currency: currency,
            frequency: frequency,
            isAvailable: available,
            unavailableReason: available
                ? nil
                : (unavailableReason ?? "This company publishes nothing for this metric."),
            points: points.map(\.domain)
        )
    }
}

struct FundamentalsDTO: Decodable, Sendable {
    let schemaVersion: String
    let dataVersion: String?
    let ticker: String
    let frequency: String
    let currency: String?
    let retrievedAt: Date?
    let series: [FundamentalSeriesDTO]

    var domain: FundamentalsBundle {
        let frequency = ReportingPeriod.Frequency(rawValue: self.frequency) ?? .annual
        return FundamentalsBundle(
            ticker: ticker,
            frequency: frequency,
            currency: currency,
            series: series.map { $0.domain(frequency: frequency) },
            freshness: Freshness(
                asOf: series.first?.points.last?.periodEnd,
                retrievedAt: retrievedAt,
                dataVersion: dataVersion
            )
        )
    }
}

struct ScoredMetricDTO: Decodable, Sendable {
    let key: String
    let label: String
    let note: String?
    let pillar: String
    let weight: Double
    let direction: String
    let raw: Double?
    let score: Double?
    let unavailableReason: String?

    var domain: ScoredMetric? {
        guard let pillar = ScorePillar(rawValue: pillar) else { return nil }
        return ScoredMetric(
            key: key,
            label: label,
            note: note,
            pillar: pillar,
            weight: weight,
            higherIsBetter: direction == "higherIsBetter",
            raw: raw,
            score: score,
            unavailableReason: raw == nil
                ? (unavailableReason ?? "Not published for this company.")
                : nil
        )
    }
}

struct ScoreHighlightDTO: Decodable, Sendable {
    let key: String
    let label: String
    let score: Double

    var domain: ScoreHighlight {
        ScoreHighlight(key: key, label: label, score: score)
    }
}

struct ValuationDTO: Decodable, Sendable {
    let label: String?
    let level: Int?
    let sweetSpot: Bool?
}

struct QualityScoreDTO: Decodable, Sendable {
    let schemaVersion: String
    let scoreVersion: String
    let universeVersion: String
    let universeSize: Int
    let universeLabel: String?
    let ticker: String
    let sector: String?
    let total: Double?
    let grade: String
    let coverage: Double
    let coverageFloor: Double
    let pillars: [String: Double?]
    let rank: Int?
    let sectorRank: Int?
    let sectorSize: Int?
    let alerts: [String]
    let strengths: [ScoreHighlightDTO]
    let weaknesses: [ScoreHighlightDTO]
    let valuation: ValuationDTO?
    let metrics: [ScoredMetricDTO]
    let asOf: Date?
    let retrievedAt: Date?

    var domain: QualityScore {
        QualityScore(
            ticker: ticker,
            sector: sector,
            summary: ScoreSummary(
                total: total,
                grade: ScoreGrade(raw: grade),
                coverage: coverage,
                pillars: ScorePillar.dictionary(from: pillars),
                scoreVersion: scoreVersion,
                universeVersion: universeVersion,
                universeSize: universeSize
            ),
            coverageFloor: coverageFloor,
            rank: rank,
            sectorRank: sectorRank,
            sectorSize: sectorSize,
            alerts: alerts,
            strengths: strengths.map(\.domain),
            weaknesses: weaknesses.map(\.domain),
            valuationLabel: valuation?.label,
            metrics: metrics.compactMap(\.domain),
            freshness: Freshness(asOf: asOf, retrievedAt: retrievedAt, dataVersion: scoreVersion)
        )
    }
}

struct ScreenerRowDTO: Decodable, Sendable {
    let ticker: String
    let name: String
    let sector: String?
    let total: Double?
    let grade: String
    let coverage: Double
    let pillars: [String: Double?]
    let alerts: Int?
    let marketCapBillions: Double?
    let metrics: [String: Double?]

    var domain: ScreenerRow {
        ScreenerRow(
            ticker: ticker,
            name: name,
            sector: sector,
            total: total,
            grade: ScoreGrade(raw: grade),
            coverage: coverage,
            pillars: ScorePillar.dictionary(from: pillars),
            alertCount: alerts ?? 0,
            marketCapBillions: marketCapBillions,
            metrics: metrics
        )
    }
}

struct ScreenerResponseDTO: Decodable, Sendable {
    let schemaVersion: String
    let scoreVersion: String
    let universeVersion: String
    let universeLabel: String
    let universeSize: Int
    let asOf: Date?
    let retrievedAt: Date?
    let warnings: [String]?
    let unavailableMetrics: [String]?
    let cursor: String?
    let rows: [ScreenerRowDTO]

    var domain: ScreenerPage {
        ScreenerPage(
            rows: rows.map(\.domain),
            scoreVersion: scoreVersion,
            universeVersion: universeVersion,
            universeLabel: universeLabel,
            universeSize: universeSize,
            unavailableMetrics: unavailableMetrics ?? [],
            warnings: warnings ?? [],
            cursor: cursor,
            freshness: Freshness(asOf: asOf, retrievedAt: retrievedAt, dataVersion: scoreVersion)
        )
    }
}

/// One company's ingestion state, from `/v1/data-status`.
struct DataStatusEntryDTO: Decodable, Sendable {
    let ticker: String
    let periodEnd: Date?
    let readAt: Date?
    let status: String
}

struct DataStatusDTO: Decodable, Sendable {
    let schemaVersion: String
    let dataVersion: String
    let scoreVersion: String
    let universeVersion: String
    let universeSize: Int?
    let retrievedAt: Date?
    let companies: [DataStatusEntryDTO]

    var domain: DataStatus {
        DataStatus(
            dataVersion: dataVersion,
            scoreVersion: scoreVersion,
            universeVersion: universeVersion,
            universeSize: universeSize ?? companies.count,
            checkedCount: companies.count,
            // "behind" means FinScope holds an older filing than the one the
            // company has since published — worth saying, never worth hiding.
            behindCount: companies.filter { $0.status != "current" }.count,
            lastReadAt: companies.compactMap(\.readAt).max(),
            freshness: Freshness(asOf: nil, retrievedAt: retrievedAt, dataVersion: dataVersion)
        )
    }
}

/// How current FinScope's own reading is, shown in the Home header and Settings.
///
/// `universeSize` and `checkedCount` are different numbers and are kept apart:
/// the first is everything FinScope covers and scores, the second is only the
/// companies whose read state this response reports on. Showing the second as
/// if it were the first put "6 companies covered" on the same screen as a
/// score computed against 21.
struct DataStatus: Hashable, Sendable {
    let dataVersion: String
    let scoreVersion: String
    let universeVersion: String
    let universeSize: Int
    let checkedCount: Int
    let behindCount: Int
    let lastReadAt: Date?
    let freshness: Freshness
}
