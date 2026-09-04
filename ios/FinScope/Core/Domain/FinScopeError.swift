import Foundation

/// What can go wrong, in terms a screen can act on.
///
/// The distinction that matters is between "try again" and "this will not
/// work": only `network`, `rateLimited` and `building` are worth a retry
/// button, and only `building` is worth a wait.
enum FinScopeError: Error, Equatable, Hashable, Sendable {
    /// No usable connection, or the request never arrived.
    case offline
    /// The request arrived and failed in a way a retry might fix.
    case network
    /// No such company, or nothing recorded for it.
    case notFound(String)
    /// The backend is still building this company's dataset. Not an error so
    /// much as a wait, and the screen says so.
    case building(String)
    case rateLimited
    /// The response arrived but could not be read as the contract says it should.
    /// Always a bug on one side or the other, and never presented as the
    /// reader's problem.
    case decoding(String)
    case cancelled
    case unknown(String)

    /// The headline. One clause, no apology, no jargon.
    var title: String {
        switch self {
        case .offline: "You're offline"
        case .network: "Couldn't reach FinScope"
        case .notFound: "Not found"
        case .building: "Still building"
        case .rateLimited: "Too many requests"
        case .decoding: "Unexpected response"
        case .cancelled: "Cancelled"
        case .unknown: "Something went wrong"
        }
    }

    /// What actually happened and what the reader can do about it.
    var message: String {
        switch self {
        case .offline:
            "Anything already downloaded is still here, with the date it was read."
        case .network:
            "The connection failed on the way. Anything already downloaded is still shown."
        case .notFound(let ticker):
            "FinScope holds no filings for \(ticker)."
        case .building(let ticker):
            "FinScope is reading \(ticker)'s filings for the first time. This takes a minute or so."
        case .rateLimited:
            "FinScope is throttling requests. Give it a moment."
        case .decoding(let detail):
            "FinScope sent something this version can't read: \(detail)"
        case .cancelled:
            "The request was cancelled."
        case .unknown(let detail):
            detail
        }
    }

    /// Whether offering "Try again" is honest.
    var isRetryable: Bool {
        switch self {
        case .offline, .network, .rateLimited, .building, .unknown: true
        case .notFound, .decoding, .cancelled: false
        }
    }

    var systemImage: String {
        switch self {
        case .offline: "wifi.slash"
        case .network: "antenna.radiowaves.left.and.right.slash"
        case .notFound: "questionmark.folder"
        case .building: "hourglass"
        case .rateLimited: "clock.arrow.circlepath"
        case .decoding: "exclamationmark.triangle"
        case .cancelled: "xmark.circle"
        case .unknown: "exclamationmark.triangle"
        }
    }
}
