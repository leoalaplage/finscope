import Foundation
import Testing
@testable import FinScope

/// Formatters, filtering, routing and chart-domain rules — the small decisions
/// that are wrong in a way nobody notices until a figure is misread.
@Suite("Presentation")
struct PresentationTests {

    // MARK: - Formatters

    @Test("Money is compacted with its own currency's symbol")
    func currencyFormatting() {
        #expect(Formatter.compactCurrency(466_823_000_000, code: "USD") == "$466.8bn")
        #expect(Formatter.compactCurrency(-1_200_000_000, code: "USD") == "−$1.2bn")
        #expect(Formatter.compactCurrency(3_450_000_000_000, code: "USD") == "$3.5tn")
        // An unknown currency keeps its code rather than borrowing a dollar
        // sign, which is the one substitution the product refuses everywhere.
        #expect(Formatter.compactCurrency(1_000_000_000, code: "CHF") == "CHF 1.0bn")
    }

    @Test("A fraction and percentage points format to the same text")
    func rateUnitsAgree() {
        let asFraction = MetricValue.known(0.2928, unit: .fraction)
        let asPoints = MetricValue.known(29.28, unit: .percent)
        #expect(Formatter.value(asFraction) == Formatter.value(asPoints))
        #expect(Formatter.value(asPoints) == "29.3%")
    }

    @Test("A missing figure is a dash, never a zero")
    func missingIsNotZero() {
        let unknown = MetricValue.unavailable("Not published.", unit: .currency, currency: "USD")
        #expect(Formatter.value(unknown) == "—")
        #expect(unknown.isAvailable == false)
        #expect(unknown.reason == "Not published.")
    }

    @Test("A screen reader hears the status, not just the number")
    func accessibilityDescriptions() {
        let calculated = MetricValue.known(90.9, status: .calculated, unit: .percent)
        let spoken = calculated.accessibilityDescription(label: "ROIC")
        #expect(spoken.contains("90.9%"))
        #expect(spoken.contains("calculated"))

        let absent = MetricValue.unavailable("Not comparable for an exchange.", unit: .percent)
        let spokenAbsent = absent.accessibilityDescription(label: "ROIC")
        #expect(spokenAbsent.contains("unavailable"))
        #expect(spokenAbsent.contains("Not comparable for an exchange."))
    }

    // MARK: - Chart domain

    @Test("A flow's axis always includes zero")
    func flowIncludesZero() {
        let series = FundamentalSeries(
            metric: "revenue", label: "Revenue", unit: .currency, style: .bar,
            currency: "USD", frequency: .annual, isAvailable: true, unavailableReason: nil,
            points: [point("FY2024", 100), point("FY2025", 103)]
        )
        // Without this, a 3% rise renders as a bar three times the height of
        // the one beside it.
        #expect(series.domainMustIncludeZero)
    }

    @Test("A rate is shown against its own range unless it goes negative")
    func rateDomain() {
        let positive = FundamentalSeries(
            metric: "grossMargin", label: "Gross margin", unit: .fraction, style: .line,
            currency: nil, frequency: .annual, isAvailable: true, unavailableReason: nil,
            points: [point("FY2024", 0.44), point("FY2025", 0.47)]
        )
        #expect(positive.domainMustIncludeZero == false)

        let negative = FundamentalSeries(
            metric: "operatingMargin", label: "Operating margin", unit: .fraction, style: .line,
            currency: nil, frequency: .annual, isAvailable: true, unavailableReason: nil,
            points: [point("FY2024", -0.12), point("FY2025", 0.04)]
        )
        // A sign change is the whole story, so zero has to be on the axis.
        #expect(negative.domainMustIncludeZero)
    }

    @Test("A gap is kept as a point, not dropped")
    func gapsSurvive() {
        let series = FundamentalSeries(
            metric: "roic", label: "ROIC", unit: .fraction, style: .line,
            currency: nil, frequency: .annual, isAvailable: true, unavailableReason: nil,
            points: [
                point("FY2023", 0.30),
                SeriesPoint(
                    periodEnd: date("2024-09-28"), fiscalYear: 2024, label: "FY2024",
                    value: nil, status: .unavailable,
                    reason: "Built from figures this period does not carry.", note: nil
                ),
                point("FY2025", 0.34),
            ]
        )
        #expect(series.points.count == 3)
        // The chart plots two points and leaves the hole visible; closing it
        // would draw a value FinScope never had.
        #expect(series.plottablePoints.count == 2)
    }

    @Test("An axis label comes from the fiscal year, not from slicing the label")
    func axisLabels() {
        // The filer writes "FY 2015", with a space. Taking four characters
        // after "FY" gave " 201" and rendered every annual axis as "'01".
        let annual = SeriesPoint(
            periodEnd: date("2015-09-26"), fiscalYear: 2015, label: "FY 2015",
            value: 1, status: .reported, reason: nil, note: nil
        )
        #expect(annual.axisLabel == "'15")

        let trailing = SeriesPoint(
            periodEnd: date("2026-06-27"), fiscalYear: 2026, label: "TTM Q3 FY2026",
            value: 1, status: .calculated, reason: nil, note: nil
        )
        #expect(trailing.axisLabel == "Q3 '26")

        let earlyCentury = SeriesPoint(
            periodEnd: date("2008-09-27"), fiscalYear: 2008, label: "FY 2008",
            value: 1, status: .reported, reason: nil, note: nil
        )
        #expect(earlyCentury.axisLabel == "'08")

        // No fiscal year to build from: show what the filer called it rather
        // than inventing a year.
        let unlabelled = SeriesPoint(
            periodEnd: date("2020-01-01"), fiscalYear: nil, label: "Interim",
            value: 1, status: .reported, reason: nil, note: nil
        )
        #expect(unlabelled.axisLabel == "Interim")
    }

    @Test("Every recorded period produces a distinct, short axis label")
    func recordedAxisLabels() async throws {
        let bundle = try await FixtureRepository(latency: .zero)
            .fundamentals(ticker: "AAPL", frequency: .annual).value
        let series = try #require(bundle.series(for: "revenue"))
        let labels = series.points.suffix(10).map(\.axisLabel)
        #expect(Set(labels).count == labels.count, "Axis labels collided: \(labels)")
        #expect(labels.allSatisfy { $0.hasPrefix("'") })
    }

    @Test("A range trims periods without recomputing anything")
    func rangeTrimming() {
        let points = (2010...2025).map { point("FY\($0)", Double($0)) }
        let series = FundamentalSeries(
            metric: "revenue", label: "Revenue", unit: .currency, style: .bar,
            currency: "USD", frequency: .annual, isAvailable: true, unavailableReason: nil,
            points: points
        )
        #expect(series.limited(toLast: 5).points.count == 5)
        #expect(series.limited(toLast: 5).points.last?.label == "FY2025")
        #expect(series.limited(toLast: nil).points.count == 16)
    }

    // MARK: - Screener filtering

    @Test("Filters select from scored rows without moving any score")
    func filteringDoesNotRescore() {
        let rows = [
            row("AAPL", total: 53, grade: "B+", roic: 90),
            row("MSFT", total: 61, grade: "A−", roic: 28),
            row("CME", total: 50, grade: "NR", roic: nil),
        ]
        var filters = ScreenerFilters()
        filters.minimumScore = 52

        let kept = ScreenerFiltering.apply(filters, to: rows)
        #expect(kept.map(\.ticker) == ["MSFT", "AAPL"])
        // Every score is the one it arrived with.
        #expect(kept.first { $0.ticker == "AAPL" }?.total == 53)
    }

    @Test("A company with no figure for a filtered metric is dropped, not kept")
    func unknownFailsTheFilter() {
        let rows = [
            row("AAPL", total: 53, grade: "B+", roic: 90),
            row("CME", total: 50, grade: "NR", roic: nil),
        ]
        var filters = ScreenerFilters()
        filters.metricBounds[ScreenerMetric.roic.key] = 20

        let kept = ScreenerFiltering.apply(filters, to: rows)
        // A filter is a question. A company that does not answer it has not
        // passed it — and must not be treated as a zero either.
        #expect(kept.map(\.ticker) == ["AAPL"])
    }

    @Test("Rows with no figure sort last, whichever way the column runs")
    func unknownsSortLast() {
        let rows = [
            row("CME", total: nil, grade: "NR", roic: nil),
            row("AAPL", total: 53, grade: "B+", roic: 90),
            row("MSFT", total: 61, grade: "A−", roic: 28),
        ]
        let sorted = ScreenerFiltering.sort(rows, by: .score)
        #expect(sorted.map(\.ticker) == ["MSFT", "AAPL", "CME"])
    }

    @Test("Active filters become chips that can be removed one at a time")
    func chipsRoundTrip() {
        var filters = ScreenerFilters()
        filters.minimumScore = 60
        filters.grades = ["A+"]
        filters.metricBounds[ScreenerMetric.roic.key] = 20

        let chips = filters.chips
        #expect(chips.count == 3)
        #expect(chips.contains { $0.label == "Score ≥ 60" })
        #expect(chips.contains { $0.label == "ROIC ≥ 20%" })

        for chip in chips { filters.remove(chip: chip) }
        #expect(filters.isEmpty)
    }

    // MARK: - Routing

    @Test("Deep links open the screen they name")
    @MainActor
    func deepLinks() throws {
        let router = AppRouter()

        #expect(router.handle(try #require(URL(string: "finscope://stock/aapl"))))
        #expect(router.selectedTab == .search)
        #expect(router.searchPath == [.stock(ticker: "AAPL")])

        #expect(router.handle(try #require(URL(string: "finscope://screener"))))
        #expect(router.selectedTab == .screener)

        #expect(router.handle(try #require(URL(string: "finscope://watchlist"))))
        #expect(router.selectedTab == .watchlist)

        // An unknown link is refused rather than swallowed, so the caller can
        // pass it somewhere else.
        #expect(router.handle(try #require(URL(string: "finscope://nowhere"))) == false)
        #expect(router.handle(try #require(URL(string: "https://finscope.app/stock/AAPL"))) == false)
    }

    @Test("Pushing the same route twice does not stack it twice")
    @MainActor
    func noDuplicatePushes() {
        let router = AppRouter()
        router.showStock("AAPL")
        router.showStock("AAPL")
        #expect(router.homePath.count == 1)
    }

    // MARK: - Load state

    @Test("A refresh keeps the data on screen; a failure keeps it too")
    func loadStateKeepsData() {
        let freshness = Freshness(asOf: nil, retrievedAt: .now, dataVersion: "v23")
        let loaded = LoadState<String>.loaded("figures", freshness)

        let refreshing = loaded.refreshing()
        #expect(refreshing.value == "figures")
        #expect(refreshing.isBusy)

        let failed = refreshing.failed(.offline)
        #expect(failed.value == "figures")
        #expect(failed.error == .offline)
        // Not an initial load: there is something to look at, so no skeleton.
        #expect(failed.isInitialLoad == false)
    }

    @Test("Only the errors a retry could fix offer one")
    func retryability() {
        #expect(FinScopeError.offline.isRetryable)
        #expect(FinScopeError.building("AAPL").isRetryable)
        #expect(FinScopeError.notFound("ZZZZ").isRetryable == false)
        #expect(FinScopeError.decoding("missing field").isRetryable == false)
    }

    // MARK: - Helpers

    private func date(_ text: String) -> Date {
        ContractDate.parse(text) ?? .distantPast
    }

    private func point(_ label: String, _ value: Double) -> SeriesPoint {
        let year = Int(label.suffix(4)) ?? 2000
        return SeriesPoint(
            periodEnd: date("\(year)-09-28"), fiscalYear: year, label: label,
            value: value, status: .reported, reason: nil, note: nil
        )
    }

    private func row(_ ticker: String, total: Double?, grade: String, roic: Double?) -> ScreenerRow {
        ScreenerRow(
            ticker: ticker, name: ticker, sector: "Technology",
            total: total, grade: ScoreGrade(raw: grade), coverage: 0.8,
            pillars: [:], alertCount: 0, marketCapBillions: 100,
            metrics: [ScreenerMetric.roic.key: roic]
        )
    }
}
