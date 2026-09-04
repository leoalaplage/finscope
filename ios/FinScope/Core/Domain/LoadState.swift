import Foundation

/// How fresh the data on screen is, and where it came from.
///
/// Carried beside every payload rather than inferred from a timestamp, because
/// "when was this filed" and "when did we read it" are different questions and
/// a reader deserves both. `dataVersion` is what makes an old figure
/// explicable rather than merely old.
struct Freshness: Hashable, Sendable {
    /// The period or price date the figures describe.
    let asOf: Date?
    /// When FinScope last read the source.
    let retrievedAt: Date?
    /// The normalization version the figures were built under.
    let dataVersion: String?

    static let unknown = Freshness(asOf: nil, retrievedAt: nil, dataVersion: nil)

    /// Whether this copy came from the device's own cache rather than the network.
    /// Set by the repository, never guessed by a view.
    var isFromCache: Bool = false

    init(asOf: Date?, retrievedAt: Date?, dataVersion: String?, isFromCache: Bool = false) {
        self.asOf = asOf
        self.retrievedAt = retrievedAt
        self.dataVersion = dataVersion
        self.isFromCache = isFromCache
    }
}

/// The state of one screen's data.
///
/// Five cases rather than three booleans, and two of them carry data on
/// purpose. `refreshing` keeps the figures visible while new ones are fetched,
/// and `failed` keeps them visible when the fetch fails — which is what stops
/// a lost connection from emptying a screen the reader was using. What it must
/// never do is let stale figures pass for live ones, which is why both cases
/// carry their `Freshness` with them.
enum LoadState<Value: Sendable>: Sendable {
    case idle
    case loading
    case loaded(Value, Freshness)
    case refreshing(Value, Freshness)
    case failed(previous: Value?, previousFreshness: Freshness?, error: FinScopeError)

    /// The best data available in this state, whatever it is called.
    var value: Value? {
        switch self {
        case .idle, .loading: nil
        case .loaded(let value, _), .refreshing(let value, _): value
        case .failed(let previous, _, _): previous
        }
    }

    var freshness: Freshness? {
        switch self {
        case .idle, .loading: nil
        case .loaded(_, let freshness), .refreshing(_, let freshness): freshness
        case .failed(_, let freshness, _): freshness
        }
    }

    var error: FinScopeError? {
        if case .failed(_, _, let error) = self { return error }
        return nil
    }

    /// True while the network is being consulted, whether or not data is shown.
    var isBusy: Bool {
        switch self {
        case .loading, .refreshing: true
        case .idle, .loaded, .failed: false
        }
    }

    /// A first load with nothing to show yet — the only state that earns a
    /// full-screen skeleton.
    var isInitialLoad: Bool {
        if case .loading = self { return true }
        return false
    }

    /// Moves to a refresh without losing what is on screen.
    func refreshing() -> LoadState {
        if let value, let freshness { return .refreshing(value, freshness) }
        return .loading
    }

    /// Records a failure while keeping whatever the reader was already looking at.
    func failed(_ error: FinScopeError) -> LoadState {
        .failed(previous: value, previousFreshness: freshness, error: error)
    }
}

extension LoadState: Equatable where Value: Equatable {
    static func == (lhs: LoadState, rhs: LoadState) -> Bool {
        switch (lhs, rhs) {
        case (.idle, .idle), (.loading, .loading):
            true
        case let (.loaded(a, af), .loaded(b, bf)):
            a == b && af == bf
        case let (.refreshing(a, af), .refreshing(b, bf)):
            a == b && af == bf
        case let (.failed(a, af, ae), .failed(b, bf, be)):
            a == b && af == bf && ae == be
        default:
            false
        }
    }
}
