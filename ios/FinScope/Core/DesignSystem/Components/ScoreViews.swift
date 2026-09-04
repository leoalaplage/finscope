import SwiftUI

/// The grade, set like a compact table marker rather than a button. Rows use
/// terminal brackets; the score card uses a labelled rule with no surrounding
/// box competing with the score itself.
struct GradeBadge: View {
    let grade: ScoreGrade
    var size: Size = .regular

    enum Size { case regular, large }

    @ViewBuilder
    var body: some View {
        if size == .large {
            VStack(alignment: .leading, spacing: Theme.Spacing.hairline) {
                Text(verbatim: "GRADE")
                    .font(Theme.Typography.mono(.caption2, weight: .bold))
                    .foregroundStyle(Theme.Color.textTertiary)
                    .tracking(1)
                Text(grade.raw)
                    .font(Theme.Typography.mono(.title2, weight: .bold))
                    .foregroundStyle(grade.isRated ? Theme.Color.textPrimary : Theme.Color.textSecondary)
            }
            .padding(.leading, Theme.Spacing.group)
            .overlay(alignment: .leading) {
                Rectangle()
                    .fill(grade.isRated ? Theme.Color.textPrimary : Theme.Color.textSecondary)
                    .frame(width: 2)
            }
            .accessibilityLabel(grade.isRated ? "Grade \(grade.raw)" : ScoreGrade.notRatedExplanation)
        } else {
            Text("[\(grade.raw)]")
                .font(Theme.Typography.mono(.footnote, weight: .bold))
                .foregroundStyle(grade.isRated ? Theme.Color.textPrimary : Theme.Color.textSecondary)
                .accessibilityLabel(grade.isRated ? "Grade \(grade.raw)" : ScoreGrade.notRatedExplanation)
        }
    }
}

/// A pillar's score as a labelled bar.
struct PillarBar: View {
    let pillar: ScorePillar
    let score: Double?

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
            HStack(alignment: .firstTextBaseline) {
                Text(pillar.label)
                    .font(Theme.Typography.footnote)
                    .foregroundStyle(Theme.Color.textSecondary)
                Spacer(minLength: Theme.Spacing.sm)
                Text(Formatter.score(score))
                    .font(Theme.Typography.mono(.footnote, weight: .medium))
                    .foregroundStyle(score == nil ? Theme.Color.textTertiary : Theme.Color.textPrimary)
            }
            GeometryReader { geometry in
                ZStack(alignment: .leading) {
                    Rectangle()
                        .fill(Theme.Color.textSecondary.opacity(Theme.Opacity.barTrack))
                    if let score {
                        Rectangle()
                            .fill(Theme.Color.score(score))
                            .frame(width: geometry.size.width * min(max(score, 0), 100) / 100)
                    }
                }
            }
            .frame(height: Theme.Size.pillarBar)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            score == nil
                ? "\(pillar.label): not scored. Too few of its metrics are published."
                : "\(pillar.label): \(Formatter.score(score)) out of 100"
        )
    }
}

/// The score card: the number, the grade, and the coverage — always together.
///
/// Coverage sits at the same visual weight as the score on purpose. A 92 built
/// on 40% of the metrics is a different claim from a 92 built on 95%, and a
/// card that shows only the first number is flattering the company.
struct ScoreCard: View {
    let summary: ScoreSummary
    var onOpenDetail: (() -> Void)?

    private var coverageIsThin: Bool { summary.coverage < 0.75 }

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Theme.Spacing.lg) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                        Text(verbatim: "Quality Score")
                            .font(Theme.Typography.footnote)
                            .foregroundStyle(Theme.Color.textSecondary)
                        HStack(alignment: .firstTextBaseline, spacing: Theme.Spacing.md) {
                            Text(Formatter.score(summary.total))
                                .font(Theme.Typography.scoreNumber)
                                .foregroundStyle(Theme.Color.textPrimary)
                                .contentTransition(.numericText())
                            GradeBadge(grade: summary.grade, size: .large)
                        }
                    }
                    Spacer(minLength: Theme.Spacing.sm)
                    if onOpenDetail != nil {
                        Image(systemName: "chevron.right")
                            .font(Theme.Typography.footnote.weight(.semibold))
                            .foregroundStyle(Theme.Color.textTertiary)
                            .padding(.top, Theme.Spacing.sm)
                            .accessibilityHidden(true)
                    }
                }

                VStack(alignment: .leading, spacing: Theme.Spacing.xs) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(verbatim: "Coverage")
                            .font(Theme.Typography.footnote)
                            .foregroundStyle(Theme.Color.textSecondary)
                        Spacer(minLength: Theme.Spacing.sm)
                        Text(Formatter.coverage(summary.coverage))
                            .font(Theme.Typography.mono(.footnote, weight: .medium))
                            .foregroundStyle(coverageIsThin ? Theme.Color.negative : Theme.Color.textPrimary)
                    }
                    GeometryReader { geometry in
                        ZStack(alignment: .leading) {
                            Rectangle().fill(Theme.Color.textSecondary.opacity(Theme.Opacity.barTrack))
                            Rectangle()
                                .fill(coverageIsThin ? Theme.Color.textPrimary.opacity(0.46) : Theme.Color.textPrimary)
                                .frame(width: geometry.size.width * min(max(summary.coverage, 0), 1))
                        }
                    }
                    .frame(height: Theme.Size.pillarBar)
                }

                if !summary.grade.isRated {
                    Text(ScoreGrade.notRatedExplanation)
                        .font(Theme.Typography.caption)
                        .foregroundStyle(Theme.Color.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Text(summary.universeDescription)
                    .font(Theme.Typography.caption)
                    .foregroundStyle(Theme.Color.textTertiary)
            }
            .contentShape(Rectangle())
        }
        .onTapGesture { onOpenDetail?() }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(onOpenDetail == nil ? [] : .isButton)
        .accessibilityHint(onOpenDetail == nil ? "" : "Opens the pillar breakdown")
    }
}

#Preview("Score") {
    ScrollView {
        VStack(spacing: Theme.Spacing.lg) {
            ScoreCard(
                summary: ScoreSummary(
                    total: 53.4, grade: ScoreGrade(raw: "B+"), coverage: 0.85,
                    pillars: [.quality: 64.7, .health: 72.4, .growth: 31.4, .value: 25.5],
                    scoreVersion: "qs-1.23", universeVersion: "v23-2026-09-03", universeSize: 21
                ),
                onOpenDetail: {}
            )
            ScoreCard(
                summary: ScoreSummary(
                    total: 50.5, grade: ScoreGrade(raw: "NR"), coverage: 0.2275,
                    pillars: [.quality: 74.9, .health: 22.3, .growth: 14.8, .value: nil],
                    scoreVersion: "qs-1.23", universeVersion: "v23-2026-09-03", universeSize: 21
                )
            )
            Card {
                VStack(spacing: Theme.Spacing.md) {
                    PillarBar(pillar: .quality, score: 64.7)
                    PillarBar(pillar: .health, score: 72.4)
                    PillarBar(pillar: .growth, score: 31.4)
                    PillarBar(pillar: .value, score: nil)
                }
            }
        }
        .padding()
    }
    .background(Theme.Color.background)
}
