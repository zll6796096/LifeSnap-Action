import Foundation
import UIKit
import XCTest
@testable import LifeSnapAction

final class AppAttestLiveSmokeTests: XCTestCase {
    func testLiveSmokeUsesNoRedirectSessionForBothRequests() throws {
        let source = try String(
            contentsOfFile: #filePath,
            encoding: .utf8
        )
        let start = try XCTUnwrap(
            source.range(
                of: "    private "
                    + "func runLiveSmokeWithoutLoggingCredentials"
            )
        )
        let suffix = source[start.lowerBound...]
        let end = try XCTUnwrap(suffix.range(of: "\n    #endif"))
        let liveSmokeSource = String(suffix[..<end.lowerBound])

        XCTAssertFalse(
            liveSmokeSource.contains("URLSession." + "shared")
        )
        XCTAssertTrue(
            liveSmokeSource.contains(
                "let liveSession = SecureURLSessionFactory.shared"
            )
        )
        XCTAssertEqual(
            liveSmokeSource.components(
                separatedBy: "liveSession.data("
            ).count - 1,
            2
        )
    }

    func testLiveAppAttestAndReplayProtection() async throws {
        #if RUN_LIVE_APP_ATTEST_SMOKE
        try await runLiveSmokeWithoutLoggingCredentials()
        #else
        throw XCTSkip("RUN_LIVE_APP_ATTEST_SMOKE is not enabled")
        #endif
    }

    #if RUN_LIVE_APP_ATTEST_SMOKE
    private func runLiveSmokeWithoutLoggingCredentials() async throws {
        guard AppCheckBuildMode.current == .appAttest else {
            throw LiveSmokeError.wrongAppCheckProvider
        }

        guard let configuredValue = Bundle.main.object(
            forInfoDictionaryKey: "APIBaseURL"
        ) as? String,
        let baseURL = APIClient.validatedOrigin(from: configuredValue),
        let endpoint = URL(
            string: "/api/v2/extract",
            relativeTo: baseURL
        )?.absoluteURL
        else {
            throw LiveSmokeError.invalidConfiguration
        }

        let installationID = try KeychainInstallationIdentifierStore()
            .identifier()
        guard let installationUUID = UUID(uuidString: installationID) else {
            throw LiveSmokeError.invalidCredential
        }

        let token = try await FirebaseLimitedUseTokenProvider().token()
        let trimmedToken = token.trimmingCharacters(
            in: .whitespacesAndNewlines
        )
        guard !trimmedToken.isEmpty, trimmedToken == token else {
            throw LiveSmokeError.invalidCredential
        }
        print("app_attest_provider=PASS")

        let renderer = UIGraphicsImageRenderer(
            size: CGSize(width: 4, height: 4)
        )
        let syntheticImage = renderer.image { context in
            UIColor.white.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 4, height: 4))
            UIColor.black.setFill()
            context.fill(CGRect(x: 1, y: 1, width: 2, height: 2))
        }
        guard let pngData = syntheticImage.pngData() else {
            throw LiveSmokeError.imageGenerationFailed
        }

        let boundary = UUID().uuidString
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue(
            "multipart/form-data; boundary=\(boundary)",
            forHTTPHeaderField: "Content-Type"
        )
        request.setValue(
            trimmedToken,
            forHTTPHeaderField: "X-Firebase-AppCheck"
        )
        request.setValue(
            installationUUID.uuidString.lowercased(),
            forHTTPHeaderField: "X-LifeSnap-Install-ID"
        )

        var body = Data()
        body.append(Data("--\(boundary)\r\n".utf8))
        body.append(
            Data(
                (
                    "Content-Disposition: form-data; "
                        + "name=\"image\"; filename=\"synthetic.png\"\r\n"
                ).utf8
            )
        )
        body.append(Data("Content-Type: image/png\r\n\r\n".utf8))
        body.append(pngData)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        request.httpBody = body

        let liveSession = SecureURLSessionFactory.shared
        let (firstData, firstResponse) = try await liveSession.data(
            for: request
        )
        guard let firstHTTP = firstResponse as? HTTPURLResponse,
              firstHTTP.statusCode == 200,
              (try? JSONDecoder().decode(
                  ExtractionResponse.self,
                  from: firstData
              )) != nil
        else {
            throw LiveSmokeError.firstRequestFailed
        }
        print("v2_extract=PASS")

        let (secondData, secondResponse) = try await liveSession.data(
            for: request
        )
        guard let secondHTTP = secondResponse as? HTTPURLResponse,
              secondHTTP.statusCode == 401,
              (try? JSONDecoder().decode(
                  APIErrorResponse.self,
                  from: secondData
              ))?.code == "APP_CHECK_REPLAYED"
        else {
            throw LiveSmokeError.replayWasNotRejected
        }
        print("replay_rejected=PASS")
    }

    #endif
}

#if RUN_LIVE_APP_ATTEST_SMOKE
private enum LiveSmokeError: Error {
    case wrongAppCheckProvider
    case invalidConfiguration
    case invalidCredential
    case imageGenerationFailed
    case firstRequestFailed
    case replayWasNotRejected
}
#endif
