import Foundation

/// The four pillars, in the order the product states them.
enum ScorePillar: String, Codable, Hashable, Sendable, CaseIterable, Identifiable {
    case quality
    case health
    case growth
    case value

    var id: String { rawValue }

    var label: String {
        switch self {
        case .quality: "Quality"
        case .health: "Health"
        case .growth: "Growth"
        case .value: "Value"
        }
    }

    /// One line on what the pillar asks. The methodology sheet says more; this
    /// is what fits beside the bar.
    var question: String {
        switch self {
        case .quality: "How good is the business at turning capital into profit?"
        case .health: "Could it survive a bad few years?"
        case .growth: "Is it getting bigger, and how fast?"
        case .value: "What are you paying for all of that?"
        }
    }
}

/// The grade, as the engine assigns it. `NR` is not a bad grade — it is the
/// refusal to give one, and the app must show it as such.
struct ScoreGrade: Hashable, Sendable {
    let raw: String

    var isRated: Bool { raw.uppercased() != "NR" }

    /// What "NR" means, spelled out wherever it appears.
    static let notRatedExplanation =
        "Not rated: too few of the scored metrics are published for this company to compare it fairly."
}

/// The score as the fiche header shows it: the number, the grade, and — never
/// separated from them — the coverage that earned them.
struct ScoreSummary: Hashable, Sendable {
    let total: Double?
    let grade: ScoreGrade
    /// A fraction of one. The share of scored metrics this company published.
    let coverage: Double
    let pillars: [ScorePillar: Double?]
    let scoreVersion: String
    let universeVersion: String
    let universeSize: Int

    /// The comparison the score is against, in words. A relative score is
    /// meaningless without it, so it travels with the score everywhere.
    var universeDescription: String {
        "Scored against \(universeSize) covered companies"
    }
}

/// One scored metric with its raw figure and the points it earned.
struct ScoredMetric: Identifiable, Hashable, Sendable {
    let key: String
    let label: String
    let note: String?
    let pillar: ScorePillar
    /// The metric's weight within its pillar.
    let weight: Double
    let higherIsBetter: Bool
    /// The company's own figure, in the engine's units for this metric.
    let raw: Double?
    /// 0–100 within the universe.
    let score: Double?
    /// Present when `raw` is nil.
    let unavailableReason: String?

    var id: String { key }
}

/// The full breakdown behind a score.
struct QualityScore: Hashable, Sendable {
    let ticker: String
    let sector: String?
    let summary: ScoreSummary
    /// Below this share of scored metrics the engine withholds a grade.
    let coverageFloor: Double
    let rank: Int?
    let sectorRank: Int?
    let sectorSize: Int?
    /// The engine's alert rules this company trips, in its own words.
    let alerts: [String]
    let strengths: [ScoreHighlight]
    let weaknesses: [ScoreHighlight]
    let valuationLabel: String?
    let metrics: [ScoredMetric]
    let freshness: Freshness

    /// Metrics no figure was published for — the ones whose weight was spread
    /// across the rest. Surfaced so a high score on thin data cannot hide.
    var unavailableMetrics: [ScoredMetric] {
        metrics.filter { $0.raw == nil }
    }

    func metrics(in pillar: ScorePillar) -> [ScoredMetric] {
        metrics.filter { $0.pillar == pillar }
    }
}

/// A strength or weakness, as the engine ranks them.
struct ScoreHighlight: Identifiable, Hashable, Sendable {
    let key: String
    let label: String
    let score: Double

    var id: String { key }
}
