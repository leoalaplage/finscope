import Foundation
import Observation

/// Search: debounced, cancellable, and honest about which of its three empty
/// states you are looking at.
///
/// The three are genuinely different and a single `results.isEmpty` cannot
/// tell them apart: nothing typed yet (show recents), typed and searching
/// (show nothing, not "no results"), typed and nothing matched (say so). The
/// `Phase` enum makes that explicit rather than reconstructing it from a
/// string and an array on every render.
@MainActor
@Observable
final class SearchViewModel {

    enum Phase: Equatable {
        /// Nothing typed. Recents are the content.
        case idle
        case searching
        case results([CompanySearchResult])
        case noResults(query: String)
        case failed(FinScopeError)
    }

    var query: String = "" {
        didSet {
            guard query != oldValue else { return }
            scheduleSearch()
        }
    }

    private(set) var phase: Phase = .idle

    @ObservationIgnored private let repository: any CompanyRepository
    @ObservationIgnored private var searchTask: Task<Void, Never>?

    init(repository: any CompanyRepository) {
        self.repository = repository
    }

    /// Runs the query now, skipping the debounce — what the keyboard's Search
    /// key does.
    func submit() {
        searchTask?.cancel()
        searchTask = Task { await perform(debounce: false) }
    }

    func clear() {
        searchTask?.cancel()
        query = ""
        phase = .idle
    }

    /// Retries the last query after a failure.
    func retry() async {
        await perform(debounce: false)
    }

    // MARK: - Private

    /// Each keystroke cancels the last request before starting a new one, so
    /// a slow answer to "APP" can never arrive after a fast one to "APPL" and
    /// overwrite it.
    private func scheduleSearch() {
        searchTask?.cancel()
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            phase = .idle
            return
        }
        searchTask = Task { await perform(debounce: true) }
    }

    private func perform(debounce: Bool) async {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            phase = .idle
            return
        }

        if debounce {
            do {
                try await Task.sleep(for: .milliseconds(Theme.Duration.searchDebounceMilliseconds))
            } catch {
                return
            }
        }
        guard !Task.isCancelled else { return }

        phase = .searching
        do {
            let results = try await repository.search(query: trimmed)
            guard !Task.isCancelled else { return }
            // The query is re-read rather than captured: by the time the
            // answer lands the field may have moved on, and labelling old
            // results with the new query is how "no results for AAPL" appears
            // under a list of Apple.
            guard query.trimmingCharacters(in: .whitespacesAndNewlines) == trimmed else { return }
            phase = results.isEmpty ? .noResults(query: trimmed) : .results(results)
        } catch FinScopeError.cancelled {
            return
        } catch let error as FinScopeError {
            guard !Task.isCancelled else { return }
            phase = .failed(error)
        } catch {
            guard !Task.isCancelled else { return }
            phase = .failed(.unknown(error.localizedDescription))
        }
    }
}
