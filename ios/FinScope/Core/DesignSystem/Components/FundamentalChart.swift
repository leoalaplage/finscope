import Charts
import SwiftUI

/// One metric's history, drawn honestly.
///
/// The rules it enforces, all of which exist because the alternative misleads:
///
/// * **One metric per chart.** No second axis. Two scales in one frame invite
///   a comparison the axes do not support.
/// * **Bars for flows, lines for rates**, chosen by the series rather than by
///   the screen — a revenue is a quantity earned over a period, a margin is a
///   rate that held at one.
/// * **Zero is in the frame for a flow**, and for any rate that goes negative.
///   A bar chart cropped above zero turns a 3% rise into a doubling.
/// * **No interpolation.** A missing year is a gap, not a straight line drawn
///   through it, because the line would be a figure FinScope never had.
/// * **Negative values are drawn**, never clipped.
/// * **VoiceOver reads the series**, not just its title.
struct FundamentalChart: View {
    let series: FundamentalSeries
    @Binding var range: SeriesRange
    /// Shown only when the company has more than one frequency to offer.
    var availableFrequencies: [ReportingPeriod.Frequency] = []
    @Binding var frequency: ReportingPeriod.Frequency
    var isRefreshing: Bool = false

    @State private var selected: SeriesPoint?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var visible: FundamentalSeries {
        series.limited(toLast: range.periodCount(frequency: series.frequency))
    }

    private var points: [SeriesPoint] { visible.plottablePoints }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.md) {
            readout
            content
            controls
        }
    }

    // MARK: - Readout

    /// The selected value, or the latest one. Always occupies its full height,
    /// so scrubbing does not make the chart jump.
    private var readout: some View {
        let shown = selected ?? visible.latest
        return HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.sm) {
            if let shown, let value = shown.value {
                Text(Formatter.number(value, unit: series.unit, currency: series.currency))
                    .font(Theme.Typography.mono(.title3, weight: .semibold))
                    .foregroundStyle(Theme.Color.textPrimary)
                    .contentTransition(.numericText())
                Text(shown.label)
                    .font(Theme.Typography.footnote)
                    .foregroundStyle(Theme.Color.textSecondary)
                if shown.status == .calculated {
                    Text(verbatim: "calculated")
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Color.textTertiary)
                }
            } else {
                Text(verbatim: series.label)
                    .font(Theme.Typography.footnote)
                    .foregroundStyle(Theme.Color.textTertiary)
            }
            Spacer(minLength: 0)
        }
        .lineLimit(1)
        .frame(minHeight: Theme.Size.chartReadout, alignment: .leading)
        .accessibilityHidden(true)
    }

    // MARK: - Chart

    @ViewBuilder
    private var content: some View {
        if !series.isAvailable {
            unavailable(series.unavailableReason ?? "Nothing is published for this metric.")
        } else if points.isEmpty {
            unavailable("Nothing is published for this metric over the last \(range.rawValue).")
        } else {
            chart
                .frame(height: Theme.Size.chart)
                .opacity(isRefreshing ? Theme.Opacity.dimmed : 1)
                .animation(reduceMotion ? nil : Theme.Motion.standard, value: isRefreshing)
                .overlay { if isRefreshing { ProgressView() } }
        }
    }

    /// An absent series says why, in the space the chart would have used. It
    /// is not an error and is not styled as one.
    private func unavailable(_ reason: String) -> some View {
        VStack(spacing: Theme.Spacing.sm) {
            Image(systemName: "chart.bar.xaxis")
                .font(.title2)
                .foregroundStyle(Theme.Color.textTertiary)
            Text(reason)
                .font(Theme.Typography.footnote)
                .foregroundStyle(Theme.Color.textSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
        .frame(height: Theme.Size.chart)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(series.label): unavailable. \(reason)")
    }

    private var chart: some View {
        Chart {
            ForEach(points) { point in
                if let value = point.value {
                    if series.style == .bar {
                        BarMark(
                            x: .value("Period", point.label),
                            y: .value(series.label, value)
                        )
                        .foregroundStyle(colour(for: point, value: value))
                        .cornerRadius(0)
                    } else {
                        LineMark(
                            x: .value("Period", point.label),
                            y: .value(series.label, value)
                        )
                        .foregroundStyle(Theme.Color.accent)
                        .lineStyle(StrokeStyle(lineWidth: Theme.Stroke.chartLine, lineCap: .square))
                        // Straight segments between observations, never a
                        // curve: a spline would draw values between two years
                        // that the company never reported.
                        .interpolationMethod(.linear)

                        PointMark(
                            x: .value("Period", point.label),
                            y: .value(series.label, value)
                        )
                        .foregroundStyle(Theme.Color.accent)
                        .symbolSize(selected?.id == point.id ? Theme.Size.chartPointSymbol : 18)
                    }
                }
            }

            // A rate crossing zero gets the line that makes the crossing legible.
            if series.style == .line, visible.domainMustIncludeZero {
                RuleMark(y: .value("Zero", 0))
                    .foregroundStyle(Theme.Color.separator)
                    .lineStyle(StrokeStyle(lineWidth: Theme.Stroke.hairline))
            }

            if let selected {
                RuleMark(x: .value("Period", selected.label))
                    .foregroundStyle(Theme.Color.separator)
                    .lineStyle(StrokeStyle(lineWidth: Theme.Stroke.thin, dash: Theme.Stroke.dash))
                    .zIndex(-1)
            }
        }
        .chartYScale(domain: domain)
        .chartYAxis {
            AxisMarks(position: .trailing, values: .automatic(desiredCount: 4)) { value in
                AxisGridLine().foregroundStyle(Theme.Color.separator.opacity(0.6))
                AxisValueLabel {
                    if let number = value.as(Double.self) {
                        Text(axisLabel(number))
                    }
                }
                .font(Theme.Typography.mono(.caption2))
                .foregroundStyle(Theme.Color.textTertiary)
            }
        }
        .chartXAxis {
            AxisMarks(values: axisPeriods) { value in
                AxisValueLabel {
                    if let label = value.as(String.self) {
                        Text(shortLabels[label] ?? label)
                    }
                }
                .font(Theme.Typography.caption)
                .foregroundStyle(Theme.Color.textTertiary)
            }
        }
        .chartOverlay { proxy in
            GeometryReader { geometry in
                Rectangle()
                    .fill(.clear)
                    .contentShape(Rectangle())
                    .gesture(scrub(proxy: proxy, geometry: geometry))
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(series.label)
        .accessibilityValue(accessibilitySummary)
        // Each period is its own element, so VoiceOver can walk the series
        // rather than hear one sentence about it.
        .accessibilityChartDescriptor(
            SeriesChartDescriptor(series: visible, summary: accessibilitySummary)
        )
    }

    /// The Y domain.
    ///
    /// Zero is included for every flow and for any rate that goes negative;
    /// otherwise the rate is shown against its own range, padded so the line
    /// does not touch the frame.
    private var domain: ClosedRange<Double> {
        let values = points.compactMap(\.value)
        guard let low = values.min(), let high = values.max() else { return 0...1 }
        if visible.domainMustIncludeZero {
            let lower = min(0, low)
            let upper = max(0, high)
            let padding = (upper - lower) * 0.06
            return (lower - (lower < 0 ? padding : 0))...(upper + padding)
        }
        let padding = max((high - low) * 0.12, abs(high) * 0.02)
        return (low - padding)...(high + padding)
    }

    private func colour(for point: SeriesPoint, value: Double) -> Color {
        if let selected, selected.id != point.id {
            return Theme.Color.accent.opacity(Theme.Opacity.dimmed)
        }
        // A negative flow — a loss, a cash burn — is drawn in the negative
        // colour. It is the one place the sign carries meaning on its own.
        return value < 0 ? Theme.Color.negative : Theme.Color.accent
    }

    /// At most six labels, whatever the range, so a decade of years stays legible.
    private var axisPeriods: [String] {
        let labels = points.map(\.label)
        guard labels.count > 6 else { return labels }
        let step = Int((Double(labels.count) / 6).rounded(.up))
        return labels.enumerated().compactMap { index, label in
            index % step == 0 || index == labels.count - 1 ? label : nil
        }
    }

    /// The axis label for each period, keyed by the full label the chart plots
    /// against.
    private var shortLabels: [String: String] {
        Dictionary(visible.points.map { ($0.label, $0.axisLabel) }) { first, _ in first }
    }

    private func axisLabel(_ value: Double) -> String {
        switch series.unit {
        case .currency, .perShare:
            Formatter.compactCurrency(value, code: series.currency)
        case .fraction:
            Formatter.percentagePoints(value * 100, fractionDigits: 0)
        case .percent:
            Formatter.percentagePoints(value, fractionDigits: 0)
        case .shares:
            Formatter.compactCount(value)
        case .ratio:
            Formatter.ratio(value)
        }
    }

    // MARK: - Scrubbing

    private func scrub(proxy: ChartProxy, geometry: GeometryProxy) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { drag in
                guard let plotFrame = proxy.plotFrame else { return }
                let x = drag.location.x - geometry[plotFrame].origin.x
                let width = geometry[plotFrame].width
                guard width > 0, !points.isEmpty else { return }
                let step = width / CGFloat(points.count)
                let index = min(max(Int(x / step), 0), points.count - 1)
                let candidate = points[index]
                if candidate.id != selected?.id {
                    selected = candidate
                    Haptics.selection()
                }
            }
            .onEnded { _ in selected = nil }
    }

    // MARK: - Controls

    private var controls: some View {
        VStack(spacing: Theme.Spacing.sm) {
            Picker("Range", selection: $range) {
                ForEach(SeriesRange.allCases) { option in
                    Text(option.rawValue).tag(option)
                }
            }
            .pickerStyle(.segmented)
            .onChange(of: range) { selected = nil }

            // Only offered where the company actually has both. A toggle that
            // switches to an empty series is a promise the data does not keep.
            if availableFrequencies.count > 1 {
                Picker("Frequency", selection: $frequency) {
                    ForEach(availableFrequencies, id: \.self) { option in
                        Text(option.shortLabel).tag(option)
                    }
                }
                .pickerStyle(.segmented)
                .onChange(of: frequency) { selected = nil }
            }
        }
    }

    // MARK: - Accessibility

    private var accessibilitySummary: String {
        guard let first = points.first, let last = points.last,
              let start = first.value, let end = last.value else {
            return series.unavailableReason ?? "No values available."
        }
        let unit = series.unit
        let currency = series.currency
        var summary = "\(points.count) periods, \(first.label) to \(last.label). "
        summary += "From \(Formatter.number(start, unit: unit, currency: currency)) "
        summary += "to \(Formatter.number(end, unit: unit, currency: currency))."
        let gaps = visible.points.count - points.count
        if gaps > 0 {
            summary += " \(gaps) period\(gaps == 1 ? "" : "s") with no published figure."
        }
        return summary
    }
}

/// Makes the series navigable by VoiceOver point by point, and playable as an
/// audio graph — the difference between knowing a chart exists and reading it.
///
/// A separate type rather than a conformance on the view: `AXChartDescriptor`
/// is built off the main actor, and a `View` in Swift 6 is main-actor
/// isolated, so the descriptor takes the two `Sendable` values it needs and
/// leaves the view alone.
private struct SeriesChartDescriptor: AXChartDescriptorRepresentable {
    let series: FundamentalSeries
    let summary: String

    func makeChartDescriptor() -> AXChartDescriptor {
        let plotted = series.plottablePoints
        let values = plotted.compactMap(\.value)

        let xAxis = AXCategoricalDataAxisDescriptor(
            title: "Period",
            categoryOrder: plotted.map(\.label)
        )
        let yAxis = AXNumericDataAxisDescriptor(
            title: series.label,
            range: (values.min() ?? 0)...(values.max() ?? 1),
            gridlinePositions: []
        ) { value in
            Formatter.number(value, unit: series.unit, currency: series.currency)
        }

        let dataSeries = AXDataSeriesDescriptor(
            name: series.label,
            isContinuous: series.style == .line,
            dataPoints: plotted.compactMap { point in
                point.value.map { AXDataPoint(x: point.label, y: $0) }
            }
        )

        return AXChartDescriptor(
            title: series.label,
            summary: summary,
            xAxis: xAxis,
            yAxis: yAxis,
            additionalAxes: [],
            series: [dataSeries]
        )
    }
}

#if DEBUG
private struct ChartPreviewHost: View {
    let series: FundamentalSeries
    @State private var range: SeriesRange = .tenYears
    @State private var frequency: ReportingPeriod.Frequency = .annual

    var body: some View {
        Card {
            FundamentalChart(
                series: series,
                range: $range,
                availableFrequencies: [.annual, .ttm],
                frequency: $frequency
            )
        }
        .padding()
    }
}

#Preview("Chart · flow") {
    ChartPreviewHost(series: PreviewFixtures.revenueSeries)
        .background(Theme.Color.background)
}

#Preview("Chart · rate with a gap") {
    ChartPreviewHost(series: PreviewFixtures.marginSeriesWithGap)
        .background(Theme.Color.background)
}

#Preview("Chart · unavailable") {
    ChartPreviewHost(series: PreviewFixtures.unavailableSeries)
        .background(Theme.Color.background)
}
#endif
