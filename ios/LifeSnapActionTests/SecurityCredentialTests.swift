import Foundation
import XCTest

@testable import LifeSnapAction

final class SecurityCredentialTests: XCTestCase {
    func testInstallationIdentifierIsCreatedOnceAndReused() throws {
        let keychain = InMemoryKeychain()
        let store = KeychainInstallationIdentifierStore(keychain: keychain)

        let first = try store.identifier()
        let second = try store.identifier()

        XCTAssertEqual(first, second)
        XCTAssertNotNil(UUID(uuidString: first))
        XCTAssertEqual(first, first.lowercased())
        XCTAssertEqual(keychain.readCount, 2)
        XCTAssertEqual(keychain.writeCount, 1)
        XCTAssertEqual(keychain.deleteCount, 1)
        XCTAssertEqual(keychain.lastService, "com.zll.lifesnapaction.security")
        XCTAssertEqual(keychain.lastAccount, "app-check-installation-id-v1")
    }

    func testStoredUppercaseIdentifierIsReturnedInCanonicalLowercase() throws {
        let uppercase = "A07A3650-4D3B-47AF-B024-65780094D043"
        let keychain = InMemoryKeychain(initial: Data(uppercase.utf8))
        let store = KeychainInstallationIdentifierStore(keychain: keychain)

        let identifier = try store.identifier()

        XCTAssertEqual(identifier, uppercase.lowercased())
        XCTAssertEqual(keychain.writeCount, 0)
        XCTAssertEqual(keychain.deleteCount, 0)
    }

    func testCorruptIdentifierIsDeletedAndReplacedWithoutReturningIt() throws {
        let corrupt = "not-a-uuid"
        let keychain = InMemoryKeychain(initial: Data(corrupt.utf8))
        let store = KeychainInstallationIdentifierStore(keychain: keychain)

        let identifier = try store.identifier()

        XCTAssertNotEqual(identifier, corrupt)
        XCTAssertNotNil(UUID(uuidString: identifier))
        XCTAssertEqual(identifier, identifier.lowercased())
        XCTAssertEqual(keychain.deleteCount, 1)
        XCTAssertEqual(keychain.writeCount, 1)
    }

    func testReadFailureIsPropagatedWithoutMutation() {
        let keychain = InMemoryKeychain()
        keychain.readError = TestFailure.read
        let store = KeychainInstallationIdentifierStore(keychain: keychain)

        XCTAssertThrowsError(try store.identifier()) { error in
            XCTAssertEqual(error as? TestFailure, .read)
        }
        XCTAssertEqual(keychain.deleteCount, 0)
        XCTAssertEqual(keychain.writeCount, 0)
    }

    func testDeleteFailureIsPropagatedWithoutWritingAnIdentifier() {
        let keychain = InMemoryKeychain(initial: Data("damaged".utf8))
        keychain.deleteError = TestFailure.delete
        let store = KeychainInstallationIdentifierStore(keychain: keychain)

        XCTAssertThrowsError(try store.identifier()) { error in
            XCTAssertEqual(error as? TestFailure, .delete)
        }
        XCTAssertEqual(keychain.deleteCount, 1)
        XCTAssertEqual(keychain.writeCount, 0)
    }

    func testWriteFailureIsPropagatedWithoutReturningAnIdentifier() {
        let keychain = InMemoryKeychain()
        keychain.writeError = TestFailure.write
        let store = KeychainInstallationIdentifierStore(keychain: keychain)

        XCTAssertThrowsError(try store.identifier()) { error in
            XCTAssertEqual(error as? TestFailure, .write)
        }
        XCTAssertEqual(keychain.deleteCount, 1)
        XCTAssertEqual(keychain.writeCount, 1)
        XCTAssertNil(keychain.data)
    }

    func testConcurrentCallsOnOneStoreReuseOneIdentifier() throws {
        let keychain = InMemoryKeychain()
        let store = KeychainInstallationIdentifierStore(keychain: keychain)
        let resultLock = NSLock()
        let group = DispatchGroup()
        let queue = DispatchQueue(
            label: "SecurityCredentialTests.concurrent",
            attributes: .concurrent
        )
        var identifiers: [String] = []
        var errors: [Error] = []

        for _ in 0..<16 {
            group.enter()
            queue.async {
                defer { group.leave() }
                do {
                    let identifier = try store.identifier()
                    resultLock.withLock {
                        identifiers.append(identifier)
                    }
                } catch {
                    resultLock.withLock {
                        errors.append(error)
                    }
                }
            }
        }

        XCTAssertEqual(group.wait(timeout: .now() + 5), .success)
        XCTAssertTrue(errors.isEmpty)
        XCTAssertEqual(Set(identifiers).count, 1)
        XCTAssertEqual(identifiers.count, 16)
        XCTAssertEqual(keychain.writeCount, 1)
    }

    func testConcurrentFirstCallsAcrossStoreInstancesReturnPersistedIdentifier() {
        let keychain = RaceAmplifyingKeychain(readDelay: 0.25)
        let stores = [
            KeychainInstallationIdentifierStore(keychain: keychain),
            KeychainInstallationIdentifierStore(keychain: keychain),
        ]
        let finished = DispatchGroup()
        let resultLock = NSLock()
        let queue = DispatchQueue(
            label: "SecurityCredentialTests.multiple-stores",
            attributes: .concurrent
        )
        var identifiers: [String] = []
        var errors: [Error] = []

        for store in stores {
            finished.enter()
            queue.async {
                defer { finished.leave() }

                do {
                    let identifier = try store.identifier()
                    resultLock.withLock {
                        identifiers.append(identifier)
                    }
                } catch {
                    resultLock.withLock {
                        errors.append(error)
                    }
                }
            }
        }

        XCTAssertEqual(finished.wait(timeout: .now() + 5), .success)

        XCTAssertTrue(errors.isEmpty)
        XCTAssertEqual(identifiers.count, 2)
        XCTAssertEqual(Set(identifiers).count, 1)
        XCTAssertEqual(identifiers.first, keychain.persistedIdentifier)
        XCTAssertEqual(keychain.writeCount, 1)
    }

    func testLimitedUseProviderReturnsOnlyTheTokenStringAndFetchesOnce() async throws {
        let fetch = TokenFetchStub(token: "limited-token")
        let provider = FirebaseLimitedUseTokenProvider(fetch: fetch.call)

        let token = try await provider.token()

        XCTAssertEqual(token, "limited-token")
        XCTAssertEqual(fetch.callCount, 1)
    }

    func testLimitedUseProviderPropagatesFetchFailureUnchanged() async {
        let fetch = TokenFetchStub(token: nil, error: TestFailure.fetch)
        let provider = FirebaseLimitedUseTokenProvider(fetch: fetch.call)

        do {
            _ = try await provider.token()
            XCTFail("Expected the original fetch error")
        } catch {
            XCTAssertEqual(error as? TestFailure, .fetch)
        }
        XCTAssertEqual(fetch.callCount, 1)
    }

    func testLimitedUseProviderPrefersFetchFailureWhenTokenAlsoExists() async {
        let fetch = TokenFetchStub(
            token: "must-not-be-returned",
            error: TestFailure.fetch
        )
        let provider = FirebaseLimitedUseTokenProvider(fetch: fetch.call)

        do {
            _ = try await provider.token()
            XCTFail("Expected the original fetch error")
        } catch {
            XCTAssertEqual(error as? TestFailure, .fetch)
        }
        XCTAssertEqual(fetch.callCount, 1)
    }

    func testLimitedUseProviderFailsClosedWhenTokenAndErrorAreMissing() async {
        let fetch = TokenFetchStub(token: nil, error: nil)
        let provider = FirebaseLimitedUseTokenProvider(fetch: fetch.call)

        do {
            _ = try await provider.token()
            XCTFail("Expected a credential-unavailable error")
        } catch {
            XCTAssertEqual(error as? AppCheckCredentialError, .tokenUnavailable)
            XCTAssertEqual(
                error.localizedDescription,
                "セキュリティ確認に失敗しました。もう一度お試しください。"
            )
        }
        XCTAssertEqual(fetch.callCount, 1)
    }

    func testLimitedUseProviderFailsClosedForAnEmptyToken() async {
        let fetch = TokenFetchStub(token: "", error: nil)
        let provider = FirebaseLimitedUseTokenProvider(fetch: fetch.call)

        do {
            _ = try await provider.token()
            XCTFail("Expected a credential-unavailable error")
        } catch {
            XCTAssertEqual(error as? AppCheckCredentialError, .tokenUnavailable)
        }
        XCTAssertEqual(fetch.callCount, 1)
    }

    func testLimitedUseProviderDoesNotCacheTokensBetweenCalls() async throws {
        let fetch = TokenFetchStub(tokens: ["first-token", "second-token"])
        let provider = FirebaseLimitedUseTokenProvider(fetch: fetch.call)

        let first = try await provider.token()
        let second = try await provider.token()

        XCTAssertEqual(first, "first-token")
        XCTAssertEqual(second, "second-token")
        XCTAssertEqual(fetch.callCount, 2)
    }
}

private enum TestFailure: Error, Equatable {
    case read
    case write
    case delete
    case fetch
}

private final class InMemoryKeychain: KeychainPersisting {
    private let lock = NSLock()
    private var storedData: Data?
    private var reads = 0
    private var writes = 0
    private var deletes = 0
    private var service: String?
    private var account: String?

    var readError: Error?
    var writeError: Error?
    var deleteError: Error?

    var data: Data? {
        lock.withLock { storedData }
    }

    var readCount: Int {
        lock.withLock { reads }
    }

    var writeCount: Int {
        lock.withLock { writes }
    }

    var deleteCount: Int {
        lock.withLock { deletes }
    }

    var lastService: String? {
        lock.withLock { service }
    }

    var lastAccount: String? {
        lock.withLock { account }
    }

    init(initial: Data? = nil) {
        storedData = initial
    }

    func read(service: String, account: String) throws -> Data? {
        try lock.withLock {
            reads += 1
            self.service = service
            self.account = account
            if let readError {
                throw readError
            }
            return storedData
        }
    }

    func write(
        _ data: Data,
        service: String,
        account: String
    ) throws {
        try lock.withLock {
            writes += 1
            self.service = service
            self.account = account
            if let writeError {
                throw writeError
            }
            storedData = data
        }
    }

    func delete(service: String, account: String) throws {
        try lock.withLock {
            deletes += 1
            self.service = service
            self.account = account
            if let deleteError {
                throw deleteError
            }
            storedData = nil
        }
    }
}

private final class RaceAmplifyingKeychain: KeychainPersisting {
    private let lock = NSLock()
    private let readDelay: TimeInterval
    private var storedData: Data?
    private var writes = 0

    var persistedIdentifier: String? {
        lock.withLock {
            storedData.flatMap { String(data: $0, encoding: .utf8) }
        }
    }

    var writeCount: Int {
        lock.withLock { writes }
    }

    init(readDelay: TimeInterval) {
        self.readDelay = readDelay
    }

    func read(service: String, account: String) throws -> Data? {
        let snapshot = lock.withLock { storedData }
        Thread.sleep(forTimeInterval: readDelay)
        return snapshot
    }

    func write(
        _ data: Data,
        service: String,
        account: String
    ) throws {
        lock.withLock {
            storedData = data
            writes += 1
        }
    }

    func delete(service: String, account: String) throws {
        lock.withLock {
            storedData = nil
        }
    }
}

private final class TokenFetchStub {
    private let lock = NSLock()
    private var responses: [(String?, Error?)]
    private var calls = 0

    var callCount: Int {
        lock.withLock { calls }
    }

    init(token: String?, error: Error? = nil) {
        responses = [(token, error)]
    }

    init(tokens: [String]) {
        responses = tokens.map { ($0, nil) }
    }

    func call(completion: @escaping (String?, Error?) -> Void) {
        let response = lock.withLock { () -> (String?, Error?) in
            calls += 1
            let index = min(calls - 1, responses.count - 1)
            return responses[index]
        }
        completion(response.0, response.1)
    }
}
