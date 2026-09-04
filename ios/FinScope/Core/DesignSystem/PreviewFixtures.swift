#if DEBUG
import Foundation

/// The data previews run on.
///
/// It is loaded synchronously out of the same recorded `/v1` fixtures the app
/// itself reads, so a preview shows Apple's actual revenue history and CME's
/// actual gaps. Nothing here is a plausible-looking number typed by hand: a
/// preview built on invented figures proves that a layout renders and hides
/// every question worth asking about it — whether the units are right, whether
/// a negative bar fits, whether a missing year has room for its reason.
///
/// The one thing it does invent is a *shape* the recording does not contain —
/// `emptyScore` and friends exist to preview a state, and say so.
enum PreviewFixtures {
    private static let repository = FixtureRepository(latency: .zero)

    private static func load<Value: Decodable>(_ path: String, as type: Value.Type) -> Value? {
        guard let url = Bundle.main.url(
            forResource: (path as NSString).lastPathComponent,
            withExtension: "json",
            subdirectory: "Fixtures/v1/\((path as NSString).deletingLastPathComponent)"
        ) else { return nil }
        return try? APIClient.decoder.decode(Value.self, from: try Data(contentsOf: url))
    }

    // MARK: - Companies

    static let appleSummary: CompanySummary? =
        load("companies/AAPL/summary", as: CompanySummaryDTO.self)?.domain

    /// An exchange: most industrial metrics are unavailable and it grades NR.
    static let exchangeSummary: CompanySummary? =
        load("companies/CME/summary", as: CompanySummaryDTO.self)?.domain

    static let appleScore: QualityScore? =
        load("companies/AAPL/score", as: QualityScoreDTO.self)?.domain

    static let exchangeScore: QualityScore? =
        load("companies/CME/score", as: QualityScoreDTO.self)?.domain

    static let appleFundamentals: FundamentalsBundle? =
        load("companies/AAPL/fundamentals-annual", as: FundamentalsDTO.self)?.domain

    static let exchangeFundamentals: FundamentalsBundle? =
        load("companies/CME/fundamentals-annual", as: FundamentalsDTO.self)?.domain

    static let screenerPage: ScreenerPage? =
        load("screener", as: ScreenerResponseDTO.self)?.domain

    // MARK: - Series

    /// A flow: real revenue, drawn as bars.
    static var revenueSeries: FundamentalSeries {
        appleFundamentals?.series(for: "revenue") ?? placeholder
    }

    /// A rate whose history has holes — the case a chart must not smooth over.
    static var marginSeriesWithGap: FundamentalSeries {
        exchangeFundamentals?.series(for: "operatingMargin")
            ?? appleFundamentals?.series(for: "grossMargin")
            ?? placeholder
    }

    /// A metric this company publishes nothing for.
    static var unavailableSeries: FundamentalSeries {
        exchangeFundamentals?.series(for: "roic")
            ?? FundamentalSeries(
                metric: "roic", label: "ROIC", unit: .fraction, style: .line,
                currency: nil, frequency: .annual, isAvailable: false,
                unavailableReason: "Not comparable for an exchange: borrowing is an input to this business, not a burden on it.",
                points: []
            )
    }

    /// The last resort when the bundle has no fixtures — an empty series,
    /// clearly labelled, rather than fabricated figures.
    private static let placeholder = FundamentalSeries(
        metric: "preview", label: "Preview series", unit: .currency, style: .bar,
        currency: "USD", frequency: .annual, isAvailable: false,
        unavailableReason: "No recorded fixture is bundled in this build.",
        points: []
    )
}
#endif
