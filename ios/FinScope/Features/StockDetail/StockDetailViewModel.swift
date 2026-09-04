import Foundation
import Observation

/// One company's fiche.
///
/// Three independent loads — the summary, the series, the score — each with
/// its own state, because they fail independently and a fiche whose chart is
/// slow should still show its price. They are started together and awaited
/// separately.
@MainActor
@Observable
final class StockDetailViewModel {
    let ticker: String

    private(set) var summary: LoadState<CompanySummary> = .idle
    private(set) var fundamentals: LoadState<FundamentalsBundle> = .idle
    private(set) var score: LoadState<QualityScore> = .idle

    /// The metric the main chart shows. Revenue by default: it is the figure
    /// every company has and the one every other figure is read against.
    var selectedMetric: String = "revenue"
    var range: SeriesRange = .tenYears
    var frequency: ReportingPeriod.Frequency = .annual {
        didSet {
            guard frequency != oldValue else { return }
            Task { await loadFundamentals() }
        }
    }

    @ObservationIgnored private let repository: any CompanyRepository
    @ObservationIgnored private let watchlist: WatchlistStore
    @ObservationIgnored private var loadTask: Task<Void, Never>?
    /// Which frequencies this company actually publishes. Both are attempted
    /// once; the toggle only appears for what came back.
    @ObservationIgnored private(set) var availableFrequencies: [ReportingPeriod.Frequency] = [.annual]

    init(ticker: String, repository: any CompanyRepository, watchlist: WatchlistStore) {
        self.ticker = ticker.uppercased()
        self.repository = repository
        self.watchlist = watchlist
    }

    var company: Company? { summary.value?.company }
    var isInWatchlist: Bool { watchlist.contains(ticker) }

    /// The series the chart draws, or nil while it loads.
    var selectedSeries: FundamentalSeries? {
        fundamentals.value?.series(for: selectedMetric)
    }

    /// Every metric the picker offers, in the order the bundle carries them.
    var chartableSeries: [FundamentalSeries] {
        fundamentals.value?.series ?? []
    }

    /// The first load. Idempotent, so `.task` re-running does not re-fetch.
    func load() async {
        guard case .idle = summary else { return }
        await refresh()
    }

    /// Reloads everything, keeping what is on screen while it happens.
    func refresh() async {
        loadTask?.cancel()
        let task = Task {
            await withTaskGroup(of: Void.self) { group in
                group.addTask { await self.loadSummary() }
                group.addTask { await self.loadFundamentals() }
                group.addTask { await self.loadScore() }
            }
        }
        loadTask = task
        await task.value
    }

    func toggleWatchlist() {
        let name = company?.name ?? ticker
        watchlist.toggle(ticker: ticker, name: name)
        Haptics.commit()
    }

    // MARK: - Private

    private func loadSummary() async {
        summary = summary.refreshing()
        do {
            let fetched = try await repository.summary(ticker: ticker)
            summary = .loaded(fetched.value, fetched.freshness)
        } catch FinScopeError.cancelled {
            return
        } catch let error as FinScopeError {
            summary = summary.failed(error)
        } catch {
            summary = summary.failed(.unknown(error.localizedDescription))
        }
    }

    private func loadFundamentals() async {
        fundamentals = fundamentals.refreshing()
        do {
            let fetched = try await repository.fundamentals(ticker: ticker, frequency: frequency)
            fundamentals = .loaded(fetched.value, fetched.freshness)
            // If the selected metric is not in this bundle, fall back to the
            // first that has values rather than showing an empty frame.
            if fetched.value.series(for: selectedMetric) == nil,
               let first = fetched.value.series.first(where: \.isAvailable) {
                selectedMetric = first.metric
            }
            await discoverFrequencies()
        } catch FinScopeError.cancelled {
            return
        } catch let error as FinScopeError {
            fundamentals = fundamentals.failed(error)
        } catch {
            fundamentals = fundamentals.failed(.unknown(error.localizedDescription))
        }
    }

    private func loadScore() async {
        score = score.refreshing()
        do {
            let fetched = try await repository.score(ticker: ticker)
            score = .loaded(fetched.value, fetched.freshness)
        } catch FinScopeError.cancelled {
            return
        } catch let error as FinScopeError {
            score = score.failed(error)
        } catch {
            score = score.failed(.unknown(error.localizedDescription))
        }
    }

    /// Asks once whether the other frequency exists. A failure here is not
    /// worth surfacing: the toggle simply does not appear.
    private func discoverFrequencies() async {
        guard availableFrequencies.count == 1 else { return }
        let other: ReportingPeriod.Frequency = frequency == .annual ? .ttm : .annual
        guard let bundle = try? await repository.fundamentals(ticker: ticker, frequency: other),
              bundle.value.series.contains(where: \.isAvailable) else { return }
        availableFrequencies = [.annual, .ttm]
    }
}
