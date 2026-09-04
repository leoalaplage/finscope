import SwiftUI

/// Settings: appearance, what the data is and where it comes from, and the
/// cache. Reached from Home rather than owning a tab, because it is opened
/// rarely and a fifth tab would cost more than it earns.
struct SettingsView: View {
    /// The same view model Home uses, so the two never disagree about how
    /// current the data is — and so Settings can load it when it is reached
    /// directly by a deep link rather than by scrolling past Home.
    @Bindable var dataStatus: HomeViewModel
    let onOpenMethodology: () -> Void

    @AppStorage(PreferenceKey.appearance) private var appearanceRaw = Appearance.system.rawValue
    @State private var cacheBytes: Int?
    @State private var isClearing = false

    let cache: ResponseCache?

    var body: some View {
        Form {
            Section("Appearance") {
                Picker("Theme", selection: $appearanceRaw) {
                    ForEach(Appearance.allCases) { option in
                        Text(option.label).tag(option.rawValue)
                    }
                }
                .pickerStyle(.segmented)
            }

            Section {
                if let status = dataStatus.status.value {
                    LabeledContent("Companies covered", value: "\(status.universeSize)")
                    LabeledContent("Freshness checked", value: "\(status.checkedCount)")
                    LabeledContent("Behind a newer filing", value: "\(status.behindCount)")
                    LabeledContent("Data version", value: status.dataVersion)
                    LabeledContent("Score version", value: status.scoreVersion)
                    LabeledContent("Universe", value: status.universeVersion)
                    if let readAt = status.lastReadAt {
                        LabeledContent("Last read", value: Formatter.dayAndTime(readAt))
                    }
                } else {
                    LabeledContent("Status", value: "Loading…")
                }
            } header: {
                Text("Data")
            } footer: {
                Text(
                    "Fundamentals come from SEC filings, normalised on FinScope's servers. "
                    + "Prices are end-of-day closes. Nothing is computed on this device."
                )
            }

            Section("Methodology") {
                Button {
                    onOpenMethodology()
                } label: {
                    LabeledContent("How the Quality Score works") {
                        Image(systemName: "chevron.right")
                            .font(Theme.Typography.footnote.weight(.semibold))
                            .foregroundStyle(Theme.Color.textTertiary)
                    }
                }
                .buttonStyle(.plain)
            }

            Section {
                LabeledContent("Cached responses", value: cacheDescription)
                Button(role: .destructive) {
                    clearCache()
                } label: {
                    Text(isClearing ? "Clearing…" : "Clear cache")
                }
                .disabled(isClearing || (cacheBytes ?? 0) == 0)
            } header: {
                Text("Storage")
            } footer: {
                Text("Your watchlist and recent searches are not part of the cache and are never cleared by this.")
            }

            Section {
                LabeledContent("Version", value: Bundle.main.shortVersion)
            } footer: {
                Text(
                    "FinScope is a research tool, not investment advice. "
                    + "Figures are presented as filed and as calculated, with their dates; check anything you act on."
                )
            }
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await dataStatus.load()
            await loadCacheSize()
        }
    }

    private var cacheDescription: String {
        guard let cacheBytes else { return "—" }
        // `ByteCountFormatStyle` spells zero as "Zero kB", which reads like a
        // bug rather than an empty cache.
        guard cacheBytes > 0 else { return "Empty" }
        return ByteCountFormatStyle(style: .file).format(Int64(cacheBytes))
    }

    private func loadCacheSize() async {
        guard let cache else {
            cacheBytes = 0
            return
        }
        cacheBytes = await cache.currentByteCount()
    }

    private func clearCache() {
        guard let cache else { return }
        isClearing = true
        Task {
            await cache.removeAll()
            await loadCacheSize()
            isClearing = false
        }
    }
}

/// The Quality Score, explained once, in one place.
struct MethodologyView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Spacing.xl) {
                paragraph(
                    "What it is",
                    "The Quality Score ranks a company against a fixed universe of covered "
                    + "US SEC filers on 23 metrics, grouped into four pillars: Quality, Health, "
                    + "Growth and Value. Each metric blends the company's rank within that "
                    + "universe with an absolute anchor, so a good company in a weak field "
                    + "does not score as if it were exceptional."
                )
                paragraph(
                    "Why coverage sits beside it",
                    "A company that does not publish a metric has its weight spread over the "
                    + "ones it does. That raises the score. Coverage is the share of metrics "
                    + "actually published, and below 75% FinScope withholds a grade entirely "
                    + "and shows NR — not a low grade, but a refusal to give one."
                )
                paragraph(
                    "Why the universe is versioned",
                    "A relative score only means something against a stated field. Every "
                    + "score carries the universe it was computed against, so the number on a "
                    + "company's page and the number in the screener are the same number."
                )
                paragraph(
                    "Financial businesses",
                    "Banks, brokers and exchanges are not comparable to industrial companies "
                    + "on ROIC, free cash flow or net debt: borrowing is an input to those "
                    + "businesses rather than a burden on them. FinScope leaves those metrics "
                    + "unavailable with the reason rather than computing a misleading figure."
                )
                paragraph(
                    "What this app does not do",
                    "It does not calculate anything. Every figure — every metric, every score, "
                    + "every rank — is computed on FinScope's servers and displayed here with "
                    + "its version and its date."
                )
            }
            .padding(Theme.Spacing.lg)
        }
        .background(Theme.Color.background)
        .navigationTitle("Methodology")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func paragraph(_ title: String, _ body: String) -> some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text(title)
                .font(Theme.Typography.headline)
                .foregroundStyle(Theme.Color.textPrimary)
            Text(body)
                .font(Theme.Typography.callout)
                .foregroundStyle(Theme.Color.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

enum PreferenceKey {
    static let appearance = "appearance"
}

enum Appearance: String, CaseIterable, Identifiable {
    case system, light, dark

    var id: String { rawValue }

    var label: String {
        switch self {
        case .system: "System"
        case .light: "Light"
        case .dark: "Dark"
        }
    }

    var colorScheme: ColorScheme? {
        switch self {
        case .system: nil
        case .light: .light
        case .dark: .dark
        }
    }
}

extension Bundle {
    var shortVersion: String {
        let version = infoDictionary?["CFBundleShortVersionString"] as? String ?? "—"
        let build = infoDictionary?["CFBundleVersion"] as? String ?? "—"
        return "\(version) (\(build))"
    }
}

#if DEBUG
#Preview("Settings") {
    let dependencies = AppDependencies.preview()
    return NavigationStack {
        SettingsView(
            dataStatus: HomeViewModel(repository: dependencies.dataStatus),
            onOpenMethodology: {},
            cache: nil
        )
    }
}

#Preview("Methodology") {
    NavigationStack { MethodologyView() }
}
#endif
