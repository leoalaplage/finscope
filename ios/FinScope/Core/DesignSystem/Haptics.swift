import UIKit

/// The two haptics FinScope uses, and no others.
///
/// A research tool that buzzes on every tap is a toy. These fire in exactly
/// two places: crossing to a new period while scrubbing a chart, and adding or
/// removing a company from the watchlist — a change the reader made that they
/// cannot otherwise feel.
@MainActor
enum Haptics {
    private static let selectionGenerator = UISelectionFeedbackGenerator()
    private static let impactGenerator = UIImpactFeedbackGenerator(style: .light)

    /// Moving across a chart's periods.
    static func selection() {
        selectionGenerator.selectionChanged()
    }

    /// A change the reader committed.
    static func commit() {
        impactGenerator.impactOccurred(intensity: 0.6)
    }
}
