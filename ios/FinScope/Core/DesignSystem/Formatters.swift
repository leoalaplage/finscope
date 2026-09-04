import Foundation

/// How figures become text.
///
/// One entry point — `Formatter.value(_:)` — takes a `MetricValue` and returns
/// the string for it, because the unit travels with the figure and the screen
/// should never be the thing that decides whether `0.29` is a margin or an
/// amount. The narrower helpers exist for the axis labels and chips that have
/// a bare `Double` and a known unit.
enum Formatter {

    /// The em dash a missing figure is drawn as. Never "0", never "—" invented
    /// at a call site: one glyph, one meaning, and a reason always beside it.
    static let missing = "—"

    /// The text for a figure, or the dash that stands for its absence.
    static func value(_ metric: MetricValue) -> String {
        guard let value = metric.value else { return missing }
        return number(value, unit: metric.unit, currency: metric.currency)
    }

    static func number(_ value: Double, unit: MetricUnit, currency: String? = nil) -> String {
        switch unit {
        case .currency:
            return compactCurrency(value, code: currency)
        case .perShare:
            return preciseCurrency(value, code: currency)
        case .percent:
            return percentagePoints(value)
        case .fraction:
            return percentagePoints(value * 100)
        case .shares:
            return compactCount(value)
        case .ratio:
            return ratio(value)
        }
    }

    // MARK: - Money

    /// "$466.8bn", "−$1.2bn". Compact because a fiche compares magnitudes, and
    /// nobody reads 466,823,000,000 as a number.
    static func compactCurrency(_ value: Double, code: String?) -> String {
        let symbol = currencySymbol(code)
        let sign = value < 0 ? "−" : ""
        let magnitude = abs(value)
        let (scaled, suffix): (Double, String) = switch magnitude {
        case 1e12...: (magnitude / 1e12, "tn")
        case 1e9...: (magnitude / 1e9, "bn")
        case 1e6...: (magnitude / 1e6, "m")
        case 1e3...: (magnitude / 1e3, "k")
        default: (magnitude, "")
        }
        // One decimal once a figure is scaled, two when it is not. "$1.20bn"
        // claims a precision the compaction just threw away; "$1.2bn" does not.
        //
        // The rounding rule is stated rather than inherited: Foundation's
        // default is half-to-even, which renders $3.45tn as "$3.4tn" and reads
        // as a mistake to anyone who expects a half to round up.
        let body = scaled.formatted(
            .number
                .precision(.fractionLength(suffix.isEmpty ? 2 : 1))
                .rounded(rule: .toNearestOrAwayFromZero)
        )
        return "\(sign)\(symbol)\(body)\(suffix)"
    }

    /// "$328.21" — a price or a per-share figure, at full precision.
    static func preciseCurrency(_ value: Double, code: String?, fractionDigits: Int = 2) -> String {
        guard let code else {
            return value.formatted(.number.precision(.fractionLength(fractionDigits)))
        }
        return value.formatted(.currency(code: code).precision(.fractionLength(fractionDigits)))
    }

    /// The currency's symbol, falling back to its code rather than to "$".
    /// Guessing a dollar sign onto a euro figure is the exact mistake the
    /// product refuses everywhere else.
    static func currencySymbol(_ code: String?) -> String {
        guard let code else { return "" }
        switch code.uppercased() {
        case "USD": return "$"
        case "EUR": return "€"
        case "GBP": return "£"
        case "JPY": return "¥"
        default: return "\(code) "
        }
    }

    // MARK: - Rates

    /// "6.4%" from `6.4`. The input is percentage points, always.
    static func percentagePoints(_ value: Double, fractionDigits: Int = 1) -> String {
        let body = value.formatted(.number.precision(.fractionLength(fractionDigits)))
        return "\(body.replacingOccurrences(of: "-", with: "−"))%"
    }

    /// "+1.0%" — signed, for a move where the direction is the point.
    static func signedPercentagePoints(_ value: Double, fractionDigits: Int = 2) -> String {
        let body = value.formatted(
            .number.precision(.fractionLength(fractionDigits)).sign(strategy: .always())
        )
        return "\(body.replacingOccurrences(of: "-", with: "−"))%"
    }

    /// "24.4" — a ratio, two decimals, no unit.
    static func ratio(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(2)))
            .replacingOccurrences(of: "-", with: "−")
    }

    /// "14.6bn" — a count of shares.
    static func compactCount(_ value: Double) -> String {
        value.formatted(.number.notation(.compactName).precision(.fractionLength(0...2)))
    }

    /// "91%" — coverage and other whole-percent fractions of one.
    static func coverage(_ fraction: Double) -> String {
        fraction.formatted(.percent.precision(.fractionLength(0)))
    }

    /// "53" — a score. Whole numbers: the decimals of a relative score are
    /// noise a reader would mistake for precision.
    static func score(_ value: Double?) -> String {
        guard let value else { return missing }
        return value.rounded().formatted(.number.precision(.fractionLength(0)))
    }

    /// The compact form used inside a filter chip.
    static func filterBound(_ value: Double, unit: MetricUnit) -> String {
        switch unit {
        case .percent, .fraction: percentagePoints(value, fractionDigits: 0)
        case .ratio: ratio(value)
        default: number(value, unit: unit)
        }
    }

    // MARK: - Dates

    /// "27 Jun 2026" — a period end or a price date.
    static func day(_ date: Date) -> String {
        date.formatted(.dateTime.day().month(.abbreviated).year())
    }

    /// "3 Sep at 19:00" — when something was read.
    static func dayAndTime(_ date: Date) -> String {
        date.formatted(.dateTime.day().month(.abbreviated).hour().minute())
    }

    /// "2 days ago" — how old a copy is, for the freshness line.
    static func relative(_ date: Date, now: Date = .now) -> String {
        date.formatted(
            .relative(presentation: .named, unitsStyle: .wide)
        )
    }
}

extension MetricValue {
    /// What a screen reader says. It states the figure *and* its status, so a
    /// derived number is not heard as a filed one, and reads the reason aloud
    /// where there is no figure at all.
    func accessibilityDescription(label: String) -> String {
        guard value != nil else {
            return "\(label): unavailable. \(reason ?? "")"
        }
        var description = "\(label): \(Formatter.value(self))"
        if status == .calculated { description += ", calculated by FinScope" }
        if status == .restated { description += ", restated" }
        if let basis { description += ". \(basis)" }
        return description
    }
}
