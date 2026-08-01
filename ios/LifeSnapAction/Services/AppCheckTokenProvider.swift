import FirebaseAppCheck
import Foundation

protocol AppCheckTokenProviding {
    func token() async throws -> String
}

enum AppCheckCredentialError: LocalizedError, Equatable {
    case tokenUnavailable

    var errorDescription: String? {
        "セキュリティ確認に失敗しました。もう一度お試しください。"
    }
}

struct FirebaseLimitedUseTokenProvider: AppCheckTokenProviding {
    typealias Fetch = (
        @escaping (_ token: String?, _ error: Error?) -> Void
    ) -> Void

    private let fetch: Fetch

    init(fetch: @escaping Fetch = { completion in
        AppCheck.appCheck().limitedUseToken { token, error in
            completion(token?.token, error)
        }
    }) {
        self.fetch = fetch
    }

    func token() async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            fetch { token, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let token, !token.isEmpty {
                    continuation.resume(returning: token)
                } else {
                    continuation.resume(
                        throwing: AppCheckCredentialError.tokenUnavailable
                    )
                }
            }
        }
    }
}
