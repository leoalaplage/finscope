import Foundation

/// How a figure came to be, as the backend states it.
///
/// The distinction is not decoration. A `reported` figure is one the filer
/// published; a `calculated` one is arithmetic FinScope did on figures it
/// published; a `restated` one replaces something the filer itself corrected.
/// The screen is allowed to be quieter about the first than about the third,
/// but it is never allowed to present the third as the first.
enum ValueStatus: String, Codable, Hashable, Sendable {
    case reported
    case calculated
    case restated
    case unavailable
}

/// The unit a figure is in. Carried with the figure rather than assumed by the
/// screen showing it, because the same `0.29` is a 29% margin and 29 cents.
enum MetricUnit: String, Codable, Hashable, Sendable {
    /// An amount of money, in the accompanying currency.
    case currency
    /// An amount of money per share, in the accompanying currency.
    case perShare
    /// Percentage points: `6.4` means 6.4%.
    case percent
    /// A fraction of one: `0.064` means 6.4%.
    case fraction
    /// A count of shares.
    case shares
    /// A pure ratio, such as EV/FCF.
    case ratio
}

/// One figure, or the reason there isn't one.
///
/// This type is the whole of FinScope's promise in the type system. The web
/// product's first rule is that an absent figure is *unknown*, never zero, and
/// that the empty space carries its reason. Making `value` optional and
/// `reason` non-optional-when-absent means a view physically cannot render a
/// blank without having been handed something to say about it.
///
/// `basis` is the third rule: a figure that came from a substitute basis — a
/// diluted weighted average where a period-end count was wanted — says so on
/// the line rather than passing for the figure it stood in for.
struct MetricValue: Hashable, Sendable {
    let value: Double?
    let status: ValueStatus
    let unit: MetricUnit
    let currency: String?
    /// Why there is no figure. Non-nil exactly when `value` is nil.
    let reason: String?
    /// A substitution or caveat that travels with a figure that does exist.
    let basis: String?

    init(
        value: Double?,
        status: ValueStatus,
        unit: MetricUnit,
        currency: String? = nil,
        reason: String? = nil,
        basis: String? = nil
    ) {
        self.value = value
        self.status = status
        self.unit = unit
        self.currency = currency
        self.reason = reason
        self.basis = basis
    }

    /// A figure that exists.
    static func known(
        _ value: Double,
        status: ValueStatus = .calculated,
        unit: MetricUnit,
        currency: String? = nil,
        basis: String? = nil
    ) -> MetricValue {
        MetricValue(value: value, status: status, unit: unit, currency: currency, basis: basis)
    }

    /// A figure that does not exist, and the reason it does not.
    static func unavailable(
        _ reason: String,
        unit: MetricUnit,
        currency: String? = nil
    ) -> MetricValue {
        MetricValue(value: nil, status: .unavailable, unit: unit, currency: currency, reason: reason)
    }

    var isAvailable: Bool { value != nil }

    /// The percentage points a fraction represents, for the one case where the
    /// two units meet: a chart axis that shows both. Never used to turn an
    /// unknown into a number.
    var asPercentagePoints: Double? {
        guard let value else { return nil }
        switch unit {
        case .fraction: return value * 100
        case .percent: return value
        default: return nil
        }
    }
}

/// A named figure as a screen shows it: label, the figure, and the one line of
/// context that makes it mean something.
struct NamedMetric: Identifiable, Hashable, Sendable {
    let key: String
    let label: String
    /// One sentence saying what the figure measures. Not marketing — the thing
    /// a reader needs to know to read the number correctly.
    let detail: String?
    let metric: MetricValue

    var id: String { key }
}
