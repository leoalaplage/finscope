import Foundation

/// Where the `/v1` API lives.
struct APIEnvironment: Sendable {
    let baseURL: URL

    /// The deployed Worker. `/v1` is Codex's to build; until it answers, the
    /// app runs on recorded fixtures and this constant is unused at runtime.
    static let production = APIEnvironment(
        baseURL: URL(string: "https://finscope-financial-research.leoalaplage.workers.dev")!
    )
}

/// Talks to `/v1`. Transport, decoding and error shape — no product decisions.
///
/// There is no API key here and there never will be one. A secret in an app
/// bundle is a published secret; anything FinScope needs to authenticate is
/// the backend's business, not the phone's.
struct APIClient: Sendable {
    private let environment: APIEnvironment
    private let http: HTTPClient

    init(environment: APIEnvironment = .production, http: HTTPClient = URLSessionHTTPClient()) {
        self.environment = environment
        self.http = http
    }

    /// One decoder for the whole contract, so no endpoint can quietly adopt a
    /// different date format.
    static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            guard let date = ContractDate.parse(text) else {
                throw DecodingError.dataCorrupted(
                    DecodingError.Context(
                        codingPath: decoder.codingPath,
                        debugDescription: "Not a contract date: \(text)"
                    )
                )
            }
            return date
        }
        return decoder
    }()

    /// A GET against `/v1`, decoded.
    ///
    /// `etag` is passed through as `If-None-Match`; a 304 comes back as
    /// `nil`, which is the caller's signal that its cached copy still stands.
    func get<Value: Decodable & Sendable>(
        _ path: String,
        query: [URLQueryItem] = [],
        etag: String? = nil,
        ticker: String? = nil,
        as type: Value.Type = Value.self
    ) async throws -> APIResponse<Value>? {
        var components = URLComponents(
            url: environment.baseURL.appending(path: "v1").appending(path: path),
            resolvingAgainstBaseURL: false
        )
        if !query.isEmpty { components?.queryItems = query }
        guard let url = components?.url else {
            throw FinScopeError.unknown("Could not build a URL for \(path).")
        }

        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let etag { request.setValue(etag, forHTTPHeaderField: "If-None-Match") }

        let response = try await http.send(request)
        if response.isNotModified { return nil }
        if let failure = response.failure(ticker: ticker) { throw failure }

        do {
            let value = try Self.decoder.decode(Value.self, from: response.body)
            return APIResponse(
                value: value,
                etag: response.etag,
                body: response.body,
                version: Self.version(in: response.body)
            )
        } catch let error as DecodingError {
            throw FinScopeError.decoding(Self.describe(error))
        } catch {
            throw FinScopeError.decoding(error.localizedDescription)
        }
    }

    /// The version stamp a payload was built under, read without committing to
    /// the rest of the shape. It is what makes a cached copy servable or not.
    static func version(in body: Data) -> String? {
        struct Envelope: Decodable { let dataVersion: String?; let scoreVersion: String? }
        let envelope = try? JSONDecoder().decode(Envelope.self, from: body)
        return envelope?.dataVersion ?? envelope?.scoreVersion
    }

    /// A decoding failure in terms that name the field, so a contract drift is
    /// diagnosable from a screenshot.
    static func describe(_ error: DecodingError) -> String {
        switch error {
        case .keyNotFound(let key, let context):
            return "missing \(path(context) + key.stringValue)"
        case .typeMismatch(_, let context), .valueNotFound(_, let context):
            return "wrong type at \(path(context))"
        case .dataCorrupted(let context):
            return context.debugDescription
        @unknown default:
            return "unreadable"
        }
    }

    private static func path(_ context: DecodingError.Context) -> String {
        let joined = context.codingPath.map(\.stringValue).joined(separator: ".")
        return joined.isEmpty ? "" : "\(joined)."
    }
}

/// A decoded response with the bytes it came from.
///
/// The raw body travels with the value so the cache stores exactly what the
/// server sent, rather than a re-encoding of this version's understanding of
/// it. A cache written through today's model would silently lose any field a
/// later build learns to read.
struct APIResponse<Value: Decodable & Sendable>: Sendable {
    let value: Value
    let etag: String?
    let body: Data
    /// The `dataVersion` or `scoreVersion` the payload states.
    let version: String?
}

/// The two date shapes the contract uses: a calendar day for a period or a
/// price, an instant for a read.
///
/// Built on `Date.ISO8601FormatStyle` rather than `ISO8601DateFormatter`: the
/// format styles are value types and `Sendable`, so one shared instance is
/// safe under strict concurrency where a shared `DateFormatter` is not.
enum ContractDate {
    private static let instant = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
    private static let instantWithoutFraction = Date.ISO8601FormatStyle()

    /// A calendar day is read in UTC, so "2026-06-27" is the same day on every
    /// device. Reading it locally would shift a fiscal year-end by a day for
    /// half the world.
    private static let day = Date.ISO8601FormatStyle.iso8601Date(timeZone: .gmt)

    static func parse(_ text: String) -> Date? {
        if text.count == 10 { return try? day.parse(text) }
        return (try? instant.parse(text)) ?? (try? instantWithoutFraction.parse(text))
    }

    static func string(fromDay date: Date) -> String { date.formatted(day) }
}
