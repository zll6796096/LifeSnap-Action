import FirebaseAppCheck
import FirebaseCore

enum AppCheckBuildMode: Equatable {
    case debug
    case appAttest

    static var current: Self {
        #if DEBUG
        return .debug
        #else
        return .appAttest
        #endif
    }
}

final class LifeSnapAppAttestProviderFactory: NSObject, AppCheckProviderFactory {
    func createProvider(with app: FirebaseApp) -> AppCheckProvider? {
        AppAttestProvider(app: app)
    }
}

enum AppCheckBootstrap {
    static func configure() {
        switch AppCheckBuildMode.current {
        case .debug:
            AppCheck.setAppCheckProviderFactory(AppCheckDebugProviderFactory())
        case .appAttest:
            AppCheck.setAppCheckProviderFactory(
                LifeSnapAppAttestProviderFactory()
            )
        }
        FirebaseApp.configure()
    }
}
