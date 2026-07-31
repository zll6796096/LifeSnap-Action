import Foundation

protocol URLSessioning {
    func data(for request: URLRequest) async throws -> (Data, URLResponse)
}

extension URLSession: URLSessioning {}

final class NoRedirectURLSessionDelegate:
    NSObject,
    URLSessionTaskDelegate,
    @unchecked Sendable
{
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

enum SecureURLSessionFactory {
    static let shared = make()

    private static func make() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCredentialStorage = nil

        return URLSession(
            configuration: configuration,
            delegate: NoRedirectURLSessionDelegate(),
            delegateQueue: nil
        )
    }
}

/// Sends attested image-extraction requests to the configured backend origin.
final class APIClient {
    static let productionBaseURL =
        "https://lifesnap-action-sxielk4wua-an.a.run.app"

    static var privacyPolicyURL: URL {
        URL(string: "\(productionBaseURL)/privacy")!
    }

    private static let timeoutInterval: TimeInterval = 30

    private let baseURL: URL
    private let session: URLSessioning
    private let tokenProvider: AppCheckTokenProviding
    private let installationStore: InstallationIdentifierProviding

    convenience init(
        bundle: Bundle = .main,
        session: URLSessioning = SecureURLSessionFactory.shared,
        tokenProvider: AppCheckTokenProviding =
            FirebaseLimitedUseTokenProvider(),
        installationStore: InstallationIdentifierProviding =
            KeychainInstallationIdentifierStore()
    ) throws {
        try self.init(
            configuration: bundle.infoDictionary ?? [:],
            session: session,
            tokenProvider: tokenProvider,
            installationStore: installationStore
        )
    }

    convenience init(
        configuration: [String: Any],
        session: URLSessioning,
        tokenProvider: AppCheckTokenProviding,
        installationStore: InstallationIdentifierProviding
    ) throws {
        guard let value = configuration["APIBaseURL"] as? String,
              let url = Self.validatedOrigin(from: value)
        else {
            throw APIError.invalidConfiguration
        }

        self.init(
            validatedBaseURL: url,
            session: session,
            tokenProvider: tokenProvider,
            installationStore: installationStore
        )
    }

    init(
        baseURL: URL,
        session: URLSessioning,
        tokenProvider: AppCheckTokenProviding,
        installationStore: InstallationIdentifierProviding
    ) {
        guard Self.isValidOrigin(baseURL) else {
            preconditionFailure("APIClient requires a validated HTTPS origin")
        }
        self.baseURL = baseURL
        self.session = session
        self.tokenProvider = tokenProvider
        self.installationStore = installationStore
    }

    private init(
        validatedBaseURL: URL,
        session: URLSessioning,
        tokenProvider: AppCheckTokenProviding,
        installationStore: InstallationIdentifierProviding
    ) {
        baseURL = validatedBaseURL
        self.session = session
        self.tokenProvider = tokenProvider
        self.installationStore = installationStore
    }

    func extractEvent(from imageData: Data) async throws -> ExtractionResponse {
        var invalidTokenRetryCount = 0

        while true {
            let request = try await makeRequest(imageData: imageData)
            let data: Data
            let response: URLResponse

            do {
                (data, response) = try await session.data(for: request)
            } catch {
                throw APIError.networkUnavailable
            }

            do {
                return try decode(data: data, response: response)
            } catch let failure as ServerFailure {
                if failure.statusCode == 401,
                   failure.code == "APP_CHECK_INVALID",
                   invalidTokenRetryCount == 0
                {
                    invalidTokenRetryCount += 1
                    continue
                }
                throw failure.publicError
            }
        }
    }

    private func makeRequest(imageData: Data) async throws -> URLRequest {
        let installationID: String
        do {
            installationID = try installationStore.identifier()
        } catch {
            throw APIError.securityVerificationUnavailable
        }

        guard let uuid = UUID(uuidString: installationID),
              !installationID.isEmpty
        else {
            throw APIError.securityVerificationUnavailable
        }

        let token: String
        do {
            token = try await tokenProvider.token()
        } catch {
            throw APIError.securityVerificationUnavailable
        }

        let trimmedToken = token.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        guard !trimmedToken.isEmpty, trimmedToken == token else {
            throw APIError.securityVerificationUnavailable
        }

        guard let url = URL(
            string: "/api/v2/extract",
            relativeTo: baseURL
        )?.absoluteURL else {
            throw APIError.invalidConfiguration
        }

        let boundary = UUID().uuidString
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = Self.timeoutInterval
        request.setValue(
            "multipart/form-data; boundary=\(boundary)",
            forHTTPHeaderField: "Content-Type"
        )
        request.setValue(
            trimmedToken,
            forHTTPHeaderField: "X-Firebase-AppCheck"
        )
        request.setValue(
            uuid.uuidString.lowercased(),
            forHTTPHeaderField: "X-LifeSnap-Install-ID"
        )

        var body = Data()
        body.appendUTF8("--\(boundary)\r\n")
        body.appendUTF8(
            "Content-Disposition: form-data; "
                + "name=\"image\"; filename=\"photo.jpg\"\r\n"
        )
        body.appendUTF8("Content-Type: image/jpeg\r\n\r\n")
        body.append(imageData)
        body.appendUTF8("\r\n--\(boundary)--\r\n")
        request.httpBody = body

        return request
    }

    private func decode(
        data: Data,
        response: URLResponse
    ) throws -> ExtractionResponse {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        if httpResponse.statusCode == 200 {
            do {
                return try JSONDecoder().decode(
                    ExtractionResponse.self,
                    from: data
                )
            } catch {
                throw APIError.invalidResponse
            }
        }

        let code = (try? JSONDecoder().decode(
            APIErrorResponse.self,
            from: data
        ))?.code
        throw ServerFailure(
            statusCode: httpResponse.statusCode,
            code: code,
            publicError: Self.publicError(
                for: code,
                statusCode: httpResponse.statusCode
            )
        )
    }

    private static func publicError(
        for code: String?,
        statusCode: Int
    ) -> APIError {
        switch code {
        case "APP_CHECK_REQUIRED", "APP_CHECK_INVALID":
            return .appCheckInvalid
        case "APP_CHECK_REPLAYED":
            return .appCheckReplayed
        case "APP_ID_FORBIDDEN":
            return .appIDForbidden
        case "INSTALL_RATE_LIMITED":
            return .installationRateLimited
        case "INSTALL_DAILY_LIMITED":
            return .installationDailyLimited
        case "SERVICE_DAILY_LIMITED":
            return .serviceDailyLimited
        case "SECURITY_SERVICE_UNAVAILABLE":
            return .securityVerificationUnavailable
        default:
            switch statusCode {
            case 400:
                return .badRequest
            case 503:
                return .serviceUnavailable
            default:
                return .serverError(statusCode: statusCode)
            }
        }
    }

    static func validatedOrigin(from value: String) -> URL? {
        guard !value.isEmpty, let url = URL(string: value),
              isValidOrigin(url)
        else {
            return nil
        }
        return url
    }

    private static func isValidOrigin(_ url: URL) -> Bool {
        guard let components = URLComponents(
            url: url,
            resolvingAgainstBaseURL: false
        ),
        components.scheme?.lowercased() == "https",
        let host = components.host,
        isValidHost(host),
        components.user == nil,
        components.password == nil,
        components.query == nil,
        components.fragment == nil,
        components.port.map({ (1...65_535).contains($0) }) ?? true,
        components.path.isEmpty || components.path == "/"
        else {
            return false
        }
        return true
    }

    private static func isValidHost(_ host: String) -> Bool {
        guard !host.isEmpty, host.utf8.count <= 253 else {
            return false
        }

        let labels = host.split(
            separator: ".",
            omittingEmptySubsequences: false
        )
        return labels.allSatisfy { label in
            guard !label.isEmpty,
                  label.utf8.count <= 63,
                  label.first?.isASCIIAlphaNumeric == true,
                  label.last?.isASCIIAlphaNumeric == true
            else {
                return false
            }
            return label.allSatisfy {
                $0.isASCIIAlphaNumeric || $0 == "-"
            }
        }
    }
}

protocol ImageExtractionClient {
    func extractEvent(from imageData: Data) async throws -> ExtractionResponse
}

struct BackendImageExtractionClient: ImageExtractionClient {
    func extractEvent(from imageData: Data) async throws -> ExtractionResponse {
        let client = try APIClient()
        return try await client.extractEvent(from: imageData)
    }
}

private struct ServerFailure: Error {
    let statusCode: Int
    let code: String?
    let publicError: APIError
}

private extension Data {
    mutating func appendUTF8(_ string: String) {
        append(Data(string.utf8))
    }
}

private extension Character {
    var isASCIIAlphaNumeric: Bool {
        unicodeScalars.count == 1
            && unicodeScalars.first.map {
                ("a"..."z").contains(Character($0))
                    || ("A"..."Z").contains(Character($0))
                    || ("0"..."9").contains(Character($0))
            } == true
    }
}
