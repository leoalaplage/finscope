import Foundation
import Testing
@testable import FinScope

/// Decodes the recorded `/v1` fixtures and checks the figures survive the trip.
///
/// These are the tests that matter most right now: the fixtures are the
/// contract, and if a unit, a currency or a missing-value reason is lost
/// between the JSON and the domain, every screen above is quietly wrong.
@Suite("Contract decoding")
struct ContractDecodingTests {
    /// The tests are hosted by the app, so `Bundle.main` is the app bundle and
    /// the fixtures under test are exactly the ones it ships.
    private let repository = FixtureRepository(latency: .zero)

    @Test("Apple's summary decodes with its price, period and score")
    func appleSummary() async throws {
        let fetched = try await repository.summary(ticker: "AAPL")
        let summary = fetched.value

        #expect(summary.company.ticker == "AAPL")
        #expect(summary.company.name == "Apple Inc.")
        #expect(summary.company.isFinancial == false)

        let price = try #require(summary.price)
        #expect(price.currency == "USD")
        #expect(price.value > 0)

        let period = try #require(summary.period)
        #expect(period.frequency == .ttm)
        #expect(period.label.contains("TTM"))

        let score = try #require(summary.score)
        #expect(score.coverage > 0 && score.coverage <= 1)
        #expect(score.universeSize > 1)
        // Every pillar key the app knows must be present, even when its value
        // is nil — a missing key and a nil score are different facts.
        #expect(score.pillars.count == ScorePillar.allCases.count)

        #expect(summary.keyMetrics.count == 4)
    }

    @Test("A period end is read in UTC, so a fiscal year-end does not drift")
    func periodEndIsStable() async throws {
        let summary = try await repository.summary(ticker: "AAPL").value
        let end = try #require(summary.period?.end)

        var utc = Calendar(identifier: .iso8601)
        utc.timeZone = try #require(TimeZone(identifier: "UTC"))
        let components = utc.dateComponents([.year, .month, .day], from: end)
        // Apple's third fiscal quarter of 2026 closed on 27 June 2026. Decoded
        // in a local calendar this lands on the 26th west of Greenwich.
        #expect(components.year == 2026)
        #expect(components.month == 6)
        #expect(components.day == 27)
    }

    @Test("Fundamentals carry their unit, style and currency per series")
    func fundamentalsUnits() async throws {
        let bundle = try await repository.fundamentals(ticker: "AAPL", frequency: .annual).value

        let revenue = try #require(bundle.series(for: "revenue"))
        #expect(revenue.unit == .currency)
        #expect(revenue.style == .bar)
        #expect(revenue.currency == "USD")
        #expect(revenue.isAvailable)
        #expect(revenue.plottablePoints.count >= 10)

        let margin = try #require(bundle.series(for: "grossMargin"))
        #expect(margin.unit == .fraction)
        #expect(margin.style == .line)
        // A fraction carries no currency: labelling a margin "USD" is how a
        // rate ends up formatted as money.
        #expect(margin.currency == nil)

        let latest = try #require(margin.latest?.value)
        #expect(latest > 0 && latest < 1, "A margin is a fraction of one, not percentage points")
    }

    @Test("Revenue matches what Apple filed")
    func revenueIsTheFiledFigure() async throws {
        let bundle = try await repository.fundamentals(ticker: "AAPL", frequency: .annual).value
        let revenue = try #require(bundle.series(for: "revenue"))
        let fiscal2025 = try #require(revenue.points.first { $0.fiscalYear == 2025 })

        // Apple's FY2025 revenue, as filed: 416,161,000,000 USD. If this test
        // ever fails, either the recording drifted or the decoder is scaling
        // something it should not.
        #expect(fiscal2025.value == 416_161_000_000)
        #expect(fiscal2025.status == .reported)
    }

    @Test("An exchange's industrial metrics come back unavailable, with a reason")
    func financialBusinessGapsCarryReasons() async throws {
        let summary = try await repository.summary(ticker: "CME").value
        #expect(summary.company.isFinancial)
        #expect(summary.company.businessTypeLabel == "exchange")

        let roic = try #require(summary.keyMetrics.first { $0.key == "roic" })
        #expect(roic.metric.value == nil)
        #expect(roic.metric.status == .unavailable)
        let reason = try #require(roic.metric.reason)
        #expect(reason.contains("exchange"))
        #expect(!reason.isEmpty)
    }

    @Test("Every absent figure carries a reason, in every recorded company")
    func noSilentGaps() async throws {
        for ticker in ["AAPL", "MSFT", "NVDA", "BKNG", "CME"] {
            let summary = try await repository.summary(ticker: ticker).value
            for metric in summary.keyMetrics where metric.metric.value == nil {
                #expect(
                    metric.metric.reason?.isEmpty == false,
                    "\(ticker).\(metric.key) is missing with no reason"
                )
            }

            let bundle = try await repository.fundamentals(ticker: ticker, frequency: .annual).value
            for series in bundle.series {
                if !series.isAvailable {
                    #expect(
                        series.unavailableReason?.isEmpty == false,
                        "\(ticker).\(series.metric) is unavailable with no reason"
                    )
                }
                for point in series.points where point.value == nil {
                    #expect(
                        point.reason?.isEmpty == false,
                        "\(ticker).\(series.metric) at \(point.label) is empty with no reason"
                    )
                }
            }
        }
    }

    @Test("A score below the coverage floor is NR, not a low grade")
    func thinCoverageIsNotRated() async throws {
        let score = try await repository.score(ticker: "CME").value
        #expect(score.summary.coverage < score.coverageFloor)
        #expect(score.summary.grade.isRated == false)
        #expect(score.summary.grade.raw == "NR")
        #expect(!score.unavailableMetrics.isEmpty)
    }

    @Test("A well-covered company is graded")
    func goodCoverageIsRated() async throws {
        let score = try await repository.score(ticker: "AAPL").value
        #expect(score.summary.coverage >= score.coverageFloor)
        #expect(score.summary.grade.isRated)
        #expect(score.metrics.count == 23, "The engine scores 23 metrics")
        #expect(score.summary.total != nil)
    }

    @Test("The screener page carries its universe and every row's grade")
    func screenerPage() async throws {
        let page = try await repository.page(filters: .none, cursor: nil).value
        #expect(page.rows.count == page.universeSize)
        #expect(!page.scoreVersion.isEmpty)
        #expect(!page.universeVersion.isEmpty)
        #expect(page.sectors.count > 1)

        // Default sort is by score, descending, with unscored rows last.
        let scores = page.rows.compactMap(\.total)
        #expect(scores == scores.sorted(by: >))
    }

    @Test("A company outside the recorded set is not found, not empty")
    func unknownCompany() async {
        await #expect(throws: FinScopeError.notFound("ZZZZ")) {
            _ = try await repository.summary(ticker: "ZZZZ")
        }
    }
}
