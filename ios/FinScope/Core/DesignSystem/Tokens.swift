import SwiftUI

/// FinScope's visual foundations. No screen makes a colour, spacing or motion
/// decision outside this namespace.
///
/// The palette is almost entirely Apple's. That is the identity, not an
/// absence of one: a research tool should look like part of the phone, and
/// every colour it invents is a colour a reader has to learn. FinScope brings
/// exactly three of its own — an ink accent, and the two signs of direction —
/// and spends the rest of its distinctiveness on typography and space.
enum Theme {

    enum Color {
        static let background = SwiftUI.Color(uiColor: .systemGroupedBackground)
        static let surface = SwiftUI.Color(uiColor: .secondarySystemGroupedBackground)
        static let surfaceElevated = SwiftUI.Color(uiColor: .tertiarySystemGroupedBackground)
        static let separator = SwiftUI.Color(uiColor: .separator)
        static let textPrimary = SwiftUI.Color.primary
        static let textSecondary = SwiftUI.Color.secondary
        static let textTertiary = SwiftUI.Color(uiColor: .tertiaryLabel)
        static let accent = SwiftUI.Color("AccentColor", bundle: .main)
        static let positive = SwiftUI.Color("Positive", bundle: .main)
        static let negative = SwiftUI.Color("Negative", bundle: .main)
        static let fill = SwiftUI.Color(uiColor: .tertiarySystemFill)

        /// The colour of a move. Zero is not green — a flat day is not a good
        /// day, it is a flat day.
        static func direction(_ value: Double?) -> SwiftUI.Color {
            guard let value else { return textSecondary }
            if value > 0 { return positive }
            if value < 0 { return negative }
            return textSecondary
        }

        /// The tint of a grade badge.
        ///
        /// Four steps, not a gradient across twelve grades: a reader can tell
        /// four colours apart at a glance and cannot tell A− from B+ by hue.
        /// `NR` is grey, because it is not a low grade — it is no grade.
        static func grade(_ grade: ScoreGrade) -> SwiftUI.Color {
            guard grade.isRated else { return textSecondary }
            switch grade.raw.prefix(1) {
            case "A": return positive
            case "B": return accent
            case "C": return SwiftUI.Color(uiColor: .systemOrange)
            default: return negative
            }
        }

        /// The tint of a 0–100 score bar, on the same four steps as the grades.
        static func score(_ value: Double?) -> SwiftUI.Color {
            guard let value else { return textTertiary }
            switch value {
            case 70...: return positive
            case 55..<70: return accent
            case 40..<55: return SwiftUI.Color(uiColor: .systemOrange)
            default: return negative
            }
        }
    }

    enum Typography {
        static let largeTitle = Font.largeTitle.weight(.bold)
        static let title = Font.title3.weight(.semibold)
        static let headline = Font.headline
        static let body = Font.body
        static let callout = Font.callout
        static let footnote = Font.footnote
        static let caption = Font.caption

        /// Figures are monospaced everywhere they can change or be compared, so
        /// a digit does not move its neighbours when it ticks.
        static func mono(_ style: Font.TextStyle, weight: Font.Weight = .regular) -> Font {
            Font.system(style, design: .rounded, weight: weight).monospacedDigit()
        }

        /// The one place FinScope raises its voice: the price and the score.
        static let hero = Font.system(.largeTitle, design: .rounded, weight: .semibold).monospacedDigit()
        static let scoreNumber = Font.system(size: 44, weight: .semibold, design: .rounded).monospacedDigit()
    }

    enum Spacing {
        static let hairline: CGFloat = 2
        static let xs: CGFloat = 4
        static let sm: CGFloat = 8
        static let group: CGFloat = 10
        static let md: CGFloat = 12
        static let lg: CGFloat = 16
        static let xl: CGFloat = 24
        static let xxl: CGFloat = 32
        static let xxxl: CGFloat = 48
    }

    enum Radius {
        static let xs: CGFloat = 6
        static let sm: CGFloat = 10
        static let md: CGFloat = 14
        static let lg: CGFloat = 20
        static let chip: CGFloat = 8
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
        static let chartLine: CGFloat = 2
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
        /// The secondary line of a list row, held constant so a badge on one
        /// row does not make it taller than the next.
        static let metricLine: CGFloat = 18
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
