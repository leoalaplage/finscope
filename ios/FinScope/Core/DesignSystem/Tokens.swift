import SwiftUI

/// FinScope's visual foundations. No screen makes a colour, spacing or motion
/// decision outside this namespace.
///
/// FinScope reads like a financial terminal printed on paper: one ink, a
/// handful of neutral surfaces, and no hue carrying meaning. Direction and
/// quality are always written as a sign, a grade or a number as well as drawn.
enum Theme {

    enum Color {
        static let background = SwiftUI.Color(uiColor: .systemBackground)
        static let surface = SwiftUI.Color(uiColor: .secondarySystemBackground)
        static let surfaceElevated = SwiftUI.Color(uiColor: .tertiarySystemBackground)
        static let separator = SwiftUI.Color(uiColor: .separator)
        static let textPrimary = SwiftUI.Color.primary
        static let textSecondary = SwiftUI.Color.secondary
        static let textTertiary = SwiftUI.Color(uiColor: .tertiaryLabel)
        static let inverseText = background
        static let accent = textPrimary
        static let positive = textPrimary
        static let negative = textPrimary
        static let fill = SwiftUI.Color(uiColor: .systemGray5)

        /// Direction is communicated by its written sign rather than hue.
        static func direction(_ value: Double?) -> SwiftUI.Color {
            value == nil ? textTertiary : textPrimary
        }

        /// Rated grades use the same ink. `NR` recedes because it is no grade,
        /// not a poor one.
        static func grade(_ grade: ScoreGrade) -> SwiftUI.Color {
            grade.isRated ? textPrimary : textSecondary
        }

        /// Score intensity is a neutral ink density, never a traffic light.
        static func score(_ value: Double?) -> SwiftUI.Color {
            guard let value else { return textTertiary }
            switch value {
            case 70...: return textPrimary
            case 55..<70: return textPrimary.opacity(0.82)
            case 40..<55: return textPrimary.opacity(0.64)
            default: return textPrimary.opacity(0.46)
            }
        }
    }

    /// Two voices, and the split between them is the whole system.
    ///
    /// **Figures are monospaced**: prices, scores, percentages, tickers,
    /// grades, versions. Fixed-width digits keep a column aligned and stop a
    /// number shifting its neighbours as it updates — that is the terminal
    /// character FinScope wants, and it is functional rather than decorative.
    ///
    /// **Language is set in SF**: company names, metric labels, the sentence
    /// explaining why a figure is missing. Monospacing prose costs about a
    /// third more width per character, so "Return on invested capital" wrapped
    /// to two lines where its neighbour took one and the grid it sat in came
    /// apart. Prose in the system font is also what Dynamic Type is tuned for.
    ///
    /// Nothing is lost by the split: the page still reads as a terminal,
    /// because everything a reader scans for is in the monospaced voice.
    enum Typography {

        // MARK: Language — SF

        static let largeTitle = Font.system(.largeTitle, weight: .bold)
        static let title = Font.system(.title3, weight: .semibold)
        static let headline = Font.system(.headline)
        static let body = Font.system(.body)
        static let callout = Font.system(.callout)
        static let footnote = Font.system(.footnote)
        static let caption = Font.system(.caption)

        // MARK: Data — monospaced

        /// Figures, tickers and anything that lines up in a column.
        static func mono(_ style: Font.TextStyle, weight: Font.Weight = .regular) -> Font {
            Font.system(style, design: .monospaced, weight: weight).monospacedDigit()
        }

        /// The one price or score a screen is built around.
        static let hero = Font.system(.largeTitle, design: .monospaced, weight: .bold).monospacedDigit()
        static let scoreNumber = Font.system(size: 42, weight: .bold, design: .monospaced).monospacedDigit()

        /// Section headers and column captions: short, uppercased, tracked.
        /// Monospaced because they label columns of figures, and short enough
        /// that the extra width costs nothing.
        static let sectionLabel = Font.system(.caption2, design: .monospaced, weight: .bold)
        /// A key beside a figure — "ROIC", "READ", "DATA".
        static let dataLabel = Font.system(.caption, design: .monospaced, weight: .medium)
    }

    enum Spacing {
        static let hairline: CGFloat = 2
        static let xs: CGFloat = 4
        static let sm: CGFloat = 8
        static let group: CGFloat = 10
        static let md: CGFloat = 12
        static let lg: CGFloat = 16
        static let xl: CGFloat = 20
        static let xxl: CGFloat = 28
        static let xxxl: CGFloat = 40
    }

    enum Radius {
        static let xs: CGFloat = 2
        static let sm: CGFloat = 3
        static let md: CGFloat = 4
        static let lg: CGFloat = 6
        static let chip: CGFloat = 2
    }

    enum Motion {
        static let quick = Animation.snappy(duration: 0.18)
        static let standard = Animation.snappy(duration: 0.26)
        static let spring = Animation.spring(duration: 0.4, bounce: 0.14)
    }

    enum Duration {
        /// Long enough that a fast typist issues one request, short enough that
        /// a deliberate one does not feel stuck.
        static let searchDebounceMilliseconds = 300
        static let filterDebounceMilliseconds = 300
        static let shimmer = 1.2
    }

    enum Stroke {
        static let hairline: CGFloat = 1 / 3
        static let thin: CGFloat = 1
        static let chartLine: CGFloat = 1.5
        static let dash: [CGFloat] = [3, 3]
    }

    enum Size {
        static let minimumTouch: CGFloat = 44
        /// Tall enough that a decade of bars is readable without pinching.
        static let chart: CGFloat = 240
        static let chartReadout: CGFloat = 34
        static let chartPointSymbol: CGFloat = 70
        static let scoreRing: CGFloat = 92
        static let pillarBar: CGFloat = 6
        static let skeletonCaption: CGFloat = 11
        static let skeletonLine: CGFloat = 14
        static let skeletonHeadline: CGFloat = 30
        static let skeletonWidthShort: CGFloat = 64
        static let skeletonWidthMedium: CGFloat = 104
        static let skeletonWidthLong: CGFloat = 150
    }

    enum Opacity {
        static let chipFill: Double = 0.14
        static let barTrack: Double = 0.16
        static let disabled: Double = 0.4
        static let shimmer: Double = 0.7
        static let dimmed: Double = 0.35
        static let unavailable: Double = 0.55
    }

    enum Count {
        /// Home shows a slice of the watchlist, not the whole of it.
        static let watchlistPreview = 6
        static let recentSearches = 8
        static let loadingRows = 5
    }
}
