import Observation
import SwiftUI

/// Navigation: which tab, what is stacked on it, and the single entry point
/// for deep links. No business logic lives here.
@Observable
@MainActor
final class AppRouter {

    enum Tab: String, Hashable, CaseIterable {
        case home, search, screener, watchlist

        var label: String {
            switch self {
            case .home: "Home"
            case .search: "Search"
            case .screener: "Screener"
            case .watchlist: "Watchlist"
            }
        }

        var systemImage: String {
            switch self {
            case .home: "house"
            case .search: "magnifyingglass"
            case .screener: "line.3.horizontal.decrease"
            case .watchlist: "star"
            }
        }
    }

    /// Everything that can be pushed. Typed, so a destination that does not
    /// exist cannot be navigated to.
    enum Route: Hashable {
        case stock(ticker: String)
        case score(ticker: String)
        case section(ticker: String, section: FundamentalSection)
        case settings
        case methodology
    }

    var selectedTab: Tab = .home
    var homePath: [Route] = []
    var searchPath: [Route] = []
    var screenerPath: [Route] = []
    var watchlistPath: [Route] = []

    // MARK: - Navigation

    /// Opens a fiche on the tab the reader is already on, so the back button
    /// goes where they came from.
    func showStock(_ ticker: String) {
        push(.stock(ticker: ticker.uppercased()))
    }

    func push(_ route: Route) {
        push(route, in: selectedTab)
    }

    func push(_ route: Route, in tab: Tab) {
        switch tab {
        case .home: append(route, to: &homePath)
        case .search: append(route, to: &searchPath)
        case .screener: append(route, to: &screenerPath)
        case .watchlist: append(route, to: &watchlistPath)
        }
    }

    func popToRoot() {
        switch selectedTab {
        case .home: homePath.removeAll()
        case .search: searchPath.removeAll()
        case .screener: screenerPath.removeAll()
        case .watchlist: watchlistPath.removeAll()
        }
    }

    private func append(_ route: Route, to path: inout [Route]) {
        guard path.last != route else { return }
        path.append(route)
    }

    // MARK: - Deep links

    /// `finscope://stock/AAPL`, `finscope://screener`, `finscope://watchlist`.
    ///
    /// Returns false for anything unrecognised, so the caller can pass the URL
    /// on rather than swallowing it.
    @discardableResult
    func handle(_ url: URL) -> Bool {
        guard url.scheme?.lowercased() == "finscope" else { return false }
        let segments = url.pathComponents.filter { $0 != "/" }

        switch url.host()?.lowercased() {
        case "stock":
            guard let ticker = segments.first, !ticker.isEmpty else { return false }
            selectedTab = .search
            searchPath = [.stock(ticker: ticker.uppercased())]
            return true
        case "screener":
            selectedTab = .screener
            screenerPath = []
            return true
        case "watchlist":
            selectedTab = .watchlist
            watchlistPath = []
            return true
        case "home":
            selectedTab = .home
            homePath = []
            return true
        default:
            return false
        }
    }
}
