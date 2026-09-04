import Foundation
import Observation

/// The screener.
///
/// Filters are debounced and each change cancels the request before it, for
/// the same reason search does: a slider dragged across ten values must issue
/// one query, and the answer to the value the reader stopped on must be the
/// one that lands.
@MainActor
@Observable
final class ScreenerViewModel {
    private(set) var page: LoadState<ScreenerPage> = .idle

    /// The filters in force. Setting them schedules a reload.
    var filters: ScreenerFilters = .none {
        didSet {
            guard filters != oldValue else { return }
            scheduleReload()
        }
    }

    /// The sheet edits this copy; applying it assigns to `filters`.
    var draftFilters: ScreenerFilters = .none
    var isShowingFilters = false

    @ObservationIgnored private let repository: any ScreenerRepository
    @ObservationIgnored private var loadTask: Task<Void, Never>?

    init(repository: any ScreenerRepository) {
        self.repository = repository
    }

    var rows: [ScreenerRow] { page.value?.rows ?? [] }
    var universeLabel: String? { page.value?.universeLabel }

    /// The count line under the title. It states what was matched *and* what
    /// it was matched against, because "12 companies" alone invites a reader
    /// to think it means twelve in the market.
    var resultSummary: String {
        guard let page = page.value else { return " " }
        let matched = page.rows.count
        if filters.isEmpty {
            return "\(page.universeSize) companies"
        }
        return "\(matched) of \(page.universeSize) companies"
    }

    func load() async {
        guard case .idle = page else { return }
        await reload(debounce: false)
    }

    func refresh() async {
        await reload(debounce: false)
    }

    func openFilters() {
        draftFilters = filters
        isShowingFilters = true
    }

    func applyDraft() {
        filters = draftFilters
        isShowingFilters = false
    }

    func resetFilters() {
        draftFilters = ScreenerFilters(sort: filters.sort)
    }

    func remove(chip: FilterChip) {
        var updated = filters
        updated.remove(chip: chip)
        filters = updated
    }

    // MARK: - Private

    private func scheduleReload() {
        loadTask?.cancel()
        loadTask = Task { await reload(debounce: true) }
    }

    private func reload(debounce: Bool) async {
        if debounce {
            do {
                try await Task.sleep(for: .milliseconds(Theme.Duration.filterDebounceMilliseconds))
            } catch {
                return
            }
        }
        guard !Task.isCancelled else { return }

        page = page.refreshing()
        do {
            let fetched = try await repository.page(filters: filters, cursor: nil)
            guard !Task.isCancelled else { return }
            page = .loaded(fetched.value, fetched.freshness)
        } catch FinScopeError.cancelled {
            return
        } catch let error as FinScopeError {
            guard !Task.isCancelled else { return }
            page = page.failed(error)
        } catch {
            guard !Task.isCancelled else { return }
            page = page.failed(.unknown(error.localizedDescription))
        }
    }
}
