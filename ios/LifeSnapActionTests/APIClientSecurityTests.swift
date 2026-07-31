import Foundation
import XCTest
@testable import LifeSnapAction

final class APIClientSecurityTests: XCTestCase {
    func testRedirectDelegateRejects307And308WithoutForwardingRequest() throws {
        let delegate = NoRedirectURLSessionDelegate()
        let session = URLSession(
            configuration: .ephemeral,
            delegate: delegate,
            delegateQueue: nil
        )
        defer { session.invalidateAndCancel() }

        var original = URLRequest(
            url: URL(string: "https://origin.example/api/v2/extract")!
        )
        original.httpMethod = "POST"
        original.httpBody = image
        let task = session.dataTask(with: original)
        defer { task.cancel() }

        for status in [307, 308] {
            var forwarded = URLRequest(
                url: URL(string: "https://redirect.example/collect")!
            )
            forwarded.httpMethod = "POST"
            forwarded.httpBody = image
            forwarded.setValue(
                "sensitive-app-check-value",
                forHTTPHeaderField: "X-Firebase-AppCheck"
            )
            forwarded.setValue(
                validUUID,
                forHTTPHeaderField: "X-LifeSnap-Install-ID"
            )
            let response = try XCTUnwrap(
                HTTPURLResponse(
                    url: original.url!,
                    statusCode: status,
                    httpVersion: nil,
                    headerFields: [
                        "Location": forwarded.url!.absoluteString,
                    ]
                )
            )

            var redirectDecision: URLRequest? = forwarded
            delegate.urlSession(
                session,
                task: task,
                willPerformHTTPRedirection: response,
                newRequest: forwarded
            ) { request in
                redirectDecision = request
            }

            XCTAssertNil(redirectDecision, "status \(status)")
        }
    }

    func testProductionSessionHasNoPersistentOrSharedStores() {
        let session = SecureURLSessionFactory.make()
        defer { session.invalidateAndCancel() }

        XCTAssertTrue(session.delegate is NoRedirectURLSessionDelegate)
        let configuration = session.configuration
        XCTAssertNil(configuration.urlCache)
        XCTAssertEqual(
            configuration.requestCachePolicy,
            .reloadIgnoringLocalCacheData
        )
        XCTAssertNil(configuration.httpCookieStorage)
        XCTAssertFalse(configuration.httpShouldSetCookies)
        XCTAssertNil(configuration.urlCredentialStorage)
    }

    func testV2RequestContainsSecurityHeadersAndMultipartImage() async throws {
        let session = StubSession(responses: [.successExtraction])
        let tokens = StubTokenProvider(tokens: ["limited-1"])
        let client = makeClient(session: session, tokens: tokens)

        _ = try await client.extractEvent(from: image)

        let request = try XCTUnwrap(session.requests.first)
        XCTAssertEqual(request.url?.path, "/api/v2/extract")
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.timeoutInterval, 30)
        XCTAssertEqual(
            request.value(forHTTPHeaderField: "X-Firebase-AppCheck"),
            "limited-1"
        )
        XCTAssertEqual(
            request.value(forHTTPHeaderField: "X-LifeSnap-Install-ID"),
            validUUID
        )

        let contentType = try XCTUnwrap(
            request.value(forHTTPHeaderField: "Content-Type")
        )
        XCTAssertTrue(contentType.hasPrefix("multipart/form-data; boundary="))
        let body = try XCTUnwrap(request.httpBody)
        let bodyText = String(decoding: body, as: UTF8.self)
        XCTAssertTrue(bodyText.contains("name=\"image\""))
        XCTAssertTrue(bodyText.contains("filename=\"photo.jpg\""))
        XCTAssertTrue(bodyText.contains("Content-Type: image/jpeg"))
        XCTAssertTrue(body.contains(image))
        XCTAssertEqual(session.requests.count, 1)
        XCTAssertEqual(tokens.callCount, 1)
    }

    func testInvalidTokenRefreshesOnceWithFreshLimitedUseToken() async throws {
        let session = StubSession(responses: [
            .error(401, "APP_CHECK_INVALID", "do not expose"),
            .successExtraction,
        ])
        let tokens = StubTokenProvider(tokens: ["limited-1", "limited-2"])

        _ = try await makeClient(
            session: session,
            tokens: tokens
        ).extractEvent(from: image)

        XCTAssertEqual(session.requests.count, 2)
        XCTAssertEqual(tokens.callCount, 2)
        XCTAssertEqual(
            session.requests[0].value(
                forHTTPHeaderField: "X-Firebase-AppCheck"
            ),
            "limited-1"
        )
        XCTAssertEqual(
            session.requests[1].value(
                forHTTPHeaderField: "X-Firebase-AppCheck"
            ),
            "limited-2"
        )
    }

    func testSecondInvalidTokenFailsAfterAtMostTwoRequests() async {
        let session = StubSession(responses: [
            .error(401, "APP_CHECK_INVALID", "first secret detail"),
            .error(401, "APP_CHECK_INVALID", "second secret detail"),
        ])
        let tokens = StubTokenProvider(tokens: ["limited-1", "limited-2"])

        await assertFailure(
            of: makeClient(session: session, tokens: tokens),
            equals: invalidAppCheckMessage
        )

        XCTAssertEqual(session.requests.count, 2)
        XCTAssertEqual(tokens.callCount, 2)
    }

    func testAppCheckInvalidOnNon401StatusNeverRetries() async {
        for status in [400, 403, 429, 500, 503] {
            let session = StubSession(responses: [
                .error(
                    status,
                    "APP_CHECK_INVALID",
                    "private backend error"
                ),
            ])
            let tokens = StubTokenProvider(
                tokens: ["limited-1", "must-not-be-read"]
            )

            await assertFailure(
                of: makeClient(session: session, tokens: tokens),
                equals: invalidAppCheckMessage,
                file: #filePath,
                line: #line
            )

            XCTAssertEqual(session.requests.count, 1, "status \(status)")
            XCTAssertEqual(tokens.callCount, 1, "status \(status)")
        }
    }

    func testOnlyAppCheckInvalidIsRetried() async {
        let fixtures: [(Int, String, String)] = [
            (401, "APP_CHECK_REQUIRED", invalidAppCheckMessage),
            (401, "APP_CHECK_REPLAYED", replayedMessage),
            (403, "APP_ID_FORBIDDEN", forbiddenMessage),
            (429, "INSTALL_RATE_LIMITED", installRateMessage),
            (429, "INSTALL_DAILY_LIMITED", installDailyMessage),
            (429, "SERVICE_DAILY_LIMITED", serviceDailyMessage),
            (503, "SECURITY_SERVICE_UNAVAILABLE", securityUnavailableMessage),
        ]

        for (status, code, message) in fixtures {
            let session = StubSession(responses: [
                .error(status, code, "backend detail for \(code)"),
            ])
            let tokens = StubTokenProvider(tokens: ["limited-1", "unused"])

            await assertFailure(
                of: makeClient(session: session, tokens: tokens),
                equals: message,
                file: #filePath,
                line: #line
            )

            XCTAssertEqual(session.requests.count, 1, code)
            XCTAssertEqual(tokens.callCount, 1, code)
        }
    }

    func testTransportFailureIsStableAndNeverRetried() async {
        let session = StubSession(responses: [.transportFailure])
        let tokens = StubTokenProvider(tokens: ["limited-1", "unused"])

        await assertFailure(
            of: makeClient(session: session, tokens: tokens),
            equals: networkMessage
        )

        XCTAssertEqual(session.requests.count, 1)
        XCTAssertEqual(tokens.callCount, 1)
    }

    func testEveryServerSecurityCodeUsesExactStableJapaneseCopy() async {
        let fixtures: [(Int, String, String)] = [
            (401, "APP_CHECK_REQUIRED", invalidAppCheckMessage),
            (401, "APP_CHECK_INVALID", invalidAppCheckMessage),
            (401, "APP_CHECK_REPLAYED", replayedMessage),
            (403, "APP_ID_FORBIDDEN", forbiddenMessage),
            (429, "INSTALL_RATE_LIMITED", installRateMessage),
            (429, "INSTALL_DAILY_LIMITED", installDailyMessage),
            (429, "SERVICE_DAILY_LIMITED", serviceDailyMessage),
            (503, "SECURITY_SERVICE_UNAVAILABLE", securityUnavailableMessage),
        ]

        for (status, code, message) in fixtures {
            let session: StubSession
            let tokens: StubTokenProvider
            if code == "APP_CHECK_INVALID" {
                session = StubSession(responses: [
                    .error(status, code, "private backend error"),
                    .error(status, code, "different private backend error"),
                ])
                tokens = StubTokenProvider(tokens: ["limited-1", "limited-2"])
            } else {
                session = StubSession(responses: [
                    .error(status, code, "private backend error"),
                ])
                tokens = StubTokenProvider(tokens: ["limited-1"])
            }

            await assertFailure(
                of: makeClient(session: session, tokens: tokens),
                equals: message,
                file: #filePath,
                line: #line
            )
        }
    }

    func testUnknownAndMalformedErrorsDoNotExposeBackendMessage() async {
        let secret = "SECRET_BACKEND_DIAGNOSTIC_9182"
        let fixtures: [StubResponse] = [
            .error(418, "UNKNOWN_CODE", secret),
            .rawError(400, Data("not-json-\(secret)".utf8)),
            .rawError(
                500,
                Data("{\"error\":\"\(secret)\"}".utf8)
            ),
        ]

        for fixture in fixtures {
            let session = StubSession(responses: [fixture])
            do {
                _ = try await makeClient(session: session).extractEvent(
                    from: image
                )
                XCTFail("Expected failure")
            } catch {
                let description = (error as? LocalizedError)?.errorDescription
                    ?? error.localizedDescription
                XCTAssertFalse(description.contains(secret))
                XCTAssertFalse(description.contains("UNKNOWN_CODE"))
            }
            XCTAssertEqual(session.requests.count, 1)
        }
    }

    func testTokenFailureMapsToSecurityUnavailableBeforeSending() async {
        let session = StubSession(responses: [.successExtraction])
        let tokens = StubTokenProvider(error: CredentialFixtureError.privateSDK)

        await assertFailure(
            of: makeClient(session: session, tokens: tokens),
            equals: securityUnavailableMessage
        )

        XCTAssertEqual(session.requests.count, 0)
        XCTAssertEqual(tokens.callCount, 1)
    }

    func testEmptyTokenFailsClosedBeforeSending() async {
        let session = StubSession(responses: [.successExtraction])
        let tokens = StubTokenProvider(tokens: [""])

        await assertFailure(
            of: makeClient(session: session, tokens: tokens),
            equals: securityUnavailableMessage
        )

        XCTAssertEqual(session.requests.count, 0)
    }

    func testKeychainFailureMapsToSecurityUnavailableBeforeTokenFetch() async {
        let session = StubSession(responses: [.successExtraction])
        let tokens = StubTokenProvider(tokens: ["unused"])
        let client = APIClient(
            baseURL: injectedBaseURL,
            session: session,
            tokenProvider: tokens,
            installationStore: StubInstallationStore(
                error: CredentialFixtureError.privateKeychain
            )
        )

        await assertFailure(
            of: client,
            equals: securityUnavailableMessage
        )

        XCTAssertEqual(session.requests.count, 0)
        XCTAssertEqual(tokens.callCount, 0)
    }

    func testInvalidInstallationIdentifierFailsClosedBeforeTokenFetch() async {
        for value in ["", "not-a-uuid"] {
            let session = StubSession(responses: [.successExtraction])
            let tokens = StubTokenProvider(tokens: ["unused"])
            let client = APIClient(
                baseURL: injectedBaseURL,
                session: session,
                tokenProvider: tokens,
                installationStore: StubInstallationStore(id: value)
            )

            await assertFailure(
                of: client,
                equals: securityUnavailableMessage,
                file: #filePath,
                line: #line
            )
            XCTAssertEqual(session.requests.count, 0)
            XCTAssertEqual(tokens.callCount, 0)
        }
    }

    func testProductionURLsRemainHTTPSAndPrivacyURLIsUnchanged() {
        XCTAssertEqual(
            APIClient.productionBaseURL,
            "https://lifesnap-action-sxielk4wua-an.a.run.app"
        )
        XCTAssertEqual(
            APIClient.privacyPolicyURL.absoluteString,
            "https://lifesnap-action-sxielk4wua-an.a.run.app/privacy"
        )
    }

    func testConfiguredBaseURLAcceptsOnlyHTTPSHostWithoutUserInfo() throws {
        let valid = [
            "https://example.com",
            "https://example.com/",
            "https://example.com:8443",
        ]
        for value in valid {
            XCTAssertNoThrow(
                try makeConfiguredClient(value: value),
                value
            )
        }

        let invalid: [Any?] = [
            nil,
            "",
            "http://example.com",
            "https://",
            "https:///missing-host",
            "https://user@example.com",
            "https://user:password@example.com",
            "https://example.com/root",
            "https://example.com?query=true",
            "https://example.com#fragment",
            "https://.",
            "https://-example.com",
            "https://example-.com",
            "https://example..com",
            "https://exa_mple.com",
            "https://example.com.",
            "https://example.com:99999",
            "ftp://example.com",
            123,
        ]
        for value in invalid {
            XCTAssertThrowsError(
                try makeConfiguredClient(value: value),
                String(describing: value)
            ) { error in
                XCTAssertEqual(
                    (error as? APIError)?.errorDescription,
                    invalidConfigurationMessage
                )
            }
        }
    }

    private func makeConfiguredClient(value: Any?) throws -> APIClient {
        var configuration: [String: Any] = [:]
        if let value {
            configuration["APIBaseURL"] = value
        }
        return try APIClient(
            configuration: configuration,
            session: StubSession(responses: [.successExtraction]),
            tokenProvider: StubTokenProvider(tokens: ["limited-1"]),
            installationStore: StubInstallationStore(id: validUUID)
        )
    }

    private func assertFailure(
        of client: APIClient,
        equals expected: String,
        file: StaticString = #filePath,
        line: UInt = #line
    ) async {
        do {
            _ = try await client.extractEvent(from: image)
            XCTFail("Expected failure", file: file, line: line)
        } catch {
            XCTAssertEqual(
                (error as? LocalizedError)?.errorDescription,
                expected,
                file: file,
                line: line
            )
        }
    }
}

private let validUUID = "e8b18b25-64a6-4af9-b31f-9b0b6d3c3d4e"
private let image = Data([0x00, 0x01, 0x02, 0xff])
private let injectedBaseURL = URL(string: "https://unit.example")!

private let invalidAppCheckMessage =
    "セキュリティ確認に失敗しました。もう一度お試しください。"
private let replayedMessage =
    "安全確認に失敗しました。もう一度画像を選び直してください。"
private let forbiddenMessage =
    "このアプリのバージョンでは利用できません。最新版に更新してください。"
private let installRateMessage =
    "短時間の読み取り回数が上限に達しました。少し待ってからお試しください。"
private let installDailyMessage =
    "本日の読み取り回数が上限に達しました。明日もう一度お試しください。"
private let serviceDailyMessage =
    "本日のサービス利用上限に達しました。明日もう一度お試しください。"
private let securityUnavailableMessage =
    "安全確認を利用できません。しばらくしてからもう一度お試しください。"
private let networkMessage =
    "通信に失敗しました。通信環境を確認して、もう一度お試しください。"
private let invalidConfigurationMessage =
    "通信先の設定が無効です。アプリを再インストールしてください。"

private enum StubResponse {
    case successExtraction
    case error(Int, String, String)
    case rawError(Int, Data)
    case transportFailure
}

private final class StubSession: URLSessioning {
    private var responses: [StubResponse]
    private(set) var requests: [URLRequest] = []

    init(responses: [StubResponse]) {
        self.responses = responses
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        requests.append(request)
        guard !responses.isEmpty else {
            XCTFail("Unexpected request")
            throw URLError(.unknown)
        }
        let fixture = responses.removeFirst()
        if case .transportFailure = fixture {
            throw URLError(.networkConnectionLost)
        }

        let status: Int
        let data: Data
        switch fixture {
        case .successExtraction:
            status = 200
            data = Data(#"{"route":"no_action_detected"}"#.utf8)
        case .error(let value, let code, let message):
            status = value
            data = try JSONEncoder().encode(
                APIErrorResponse(error: message, code: code)
            )
        case .rawError(let value, let raw):
            status = value
            data = raw
        case .transportFailure:
            fatalError("Handled above")
        }

        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: status,
            httpVersion: nil,
            headerFields: ["Cache-Control": "no-store"]
        )!
        return (data, response)
    }
}

private final class StubTokenProvider: AppCheckTokenProviding {
    private var tokens: [String]
    private let error: Error?
    private(set) var callCount = 0

    init(tokens: [String] = [], error: Error? = nil) {
        self.tokens = tokens
        self.error = error
    }

    func token() async throws -> String {
        callCount += 1
        if let error {
            throw error
        }
        guard !tokens.isEmpty else {
            throw CredentialFixtureError.emptyFixture
        }
        return tokens.removeFirst()
    }
}

private struct StubInstallationStore: InstallationIdentifierProviding {
    let id: String?
    let error: Error?

    init(id: String? = nil, error: Error? = nil) {
        self.id = id
        self.error = error
    }

    func identifier() throws -> String {
        if let error {
            throw error
        }
        return id ?? ""
    }
}

private enum CredentialFixtureError: Error {
    case privateSDK
    case privateKeychain
    case emptyFixture
}

private func makeClient(
    session: StubSession,
    tokens: StubTokenProvider = StubTokenProvider(tokens: ["limited-1"])
) -> APIClient {
    APIClient(
        baseURL: injectedBaseURL,
        session: session,
        tokenProvider: tokens,
        installationStore: StubInstallationStore(id: validUUID)
    )
}
