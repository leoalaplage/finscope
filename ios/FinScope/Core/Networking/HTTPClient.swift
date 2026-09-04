import Foundation

/// Injectable transport. Every test goes through a double: no test touches the
/// network, and no screen can accidentally depend on one that does.
protocol HTTPClient: Sendable {
    func send(_ request: URLRequest) async throws -> HTTPResponse
}

struct HTTPResponse: Sendable {
    let status: Int
    let body: Data
    /// The entity tag, kept so the next request can ask for nothing when
    /// nothing has changed.
    let etag: String?
    let retryAfter: TimeInterval?

    var isSuccess: Bool { (200..<300).contains(status) }
    /// The server confirming our cached copy is still current.
    var isNotModified: Bool { status == 304 }
}

struct URLSessionHTTPClient: HTTPClient {
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    func send(_ request: URLRequest) async throws -> HTTPResponse {
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw FinScopeError.network }
            return HTTPResponse(
                status: http.statusCode,
                body: data,
                etag: http.value(forHTTPHeaderField: "ETag"),
                retryAfter: http.value(forHTTPHeaderField: "Retry-After").flatMap(TimeInterval.init)
            )
        } catch let error as FinScopeError {
            throw error
        } catch is CancellationError {
            throw FinScopeError.cancelled
        } catch let error as URLError {
            switch error.code {
            case .cancelled: throw FinScopeError.cancelled
            case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed:
                throw FinScopeError.offline
            default: throw FinScopeError.network
            }
        } catch {
            throw FinScopeError.network
        }
    }
}

extension HTTPResponse {
    /// The typed failure for a status, or nil if it succeeded.
    ///
    /// The mapping decides what a retry means, so it lives here rather than at
    /// each call site: 202 is FinScope building a dataset for the first time,
    /// which is worth waiting for; 404 is not.
    func failure(ticker: String?) -> FinScopeError? {
        switch status {
        case 200..<300 where status != 202: nil
        case 202: .building(ticker ?? "this company")
        case 404: .notFound(ticker ?? "that company")
        case 429: .rateLimited
        case 400..<500: .unknown("FinScope refused the request (\(status)).")
        default: .network
        }
    }

    var isRetryable: Bool { status == 429 || status >= 500 }
}
