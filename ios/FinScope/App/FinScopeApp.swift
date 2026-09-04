import SwiftData
import SwiftUI

@main
struct FinScopeApp: App {
    @State private var dependencies: AppDependencies
    private let container: ModelContainer

    init() {
        // A store that cannot be opened is not something to hide behind an
        // in-memory fallback: the watchlist would silently stop persisting and
        // the reader would lose it without being told. It is a crash on the
        // first launch after a bad migration, which is where it is fixable.
        let container = try! FinScopeModelContainer.make()
        self.container = container
        _dependencies = State(initialValue: .live(container: container))
    }

    var body: some Scene {
        WindowGroup {
            RootView(dependencies: dependencies)
        }
        .modelContainer(container)
    }
}
