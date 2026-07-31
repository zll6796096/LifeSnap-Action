import Foundation
import Security

protocol InstallationIdentifierProviding {
    func identifier() throws -> String
}

protocol KeychainPersisting {
    func read(service: String, account: String) throws -> Data?
    func write(
        _ data: Data,
        service: String,
        account: String
    ) throws
    func delete(service: String, account: String) throws
}

enum KeychainPersistenceError: LocalizedError, Equatable {
    case readFailed
    case writeFailed
    case deleteFailed

    var errorDescription: String? {
        "端末のセキュリティ情報を利用できません。もう一度お試しください。"
    }
}

struct SystemKeychain: KeychainPersisting {
    func read(service: String, account: String) throws -> Data? {
        var query = baseQuery(service: service, account: account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        switch status {
        case errSecSuccess:
            guard let data = result as? Data else {
                throw KeychainPersistenceError.readFailed
            }
            return data
        case errSecItemNotFound:
            return nil
        default:
            throw KeychainPersistenceError.readFailed
        }
    }

    func write(
        _ data: Data,
        service: String,
        account: String
    ) throws {
        let query = baseQuery(service: service, account: account)
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] =
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly

        let status = SecItemAdd(item as CFDictionary, nil)
        if status == errSecSuccess {
            return
        }

        guard status == errSecDuplicateItem else {
            throw KeychainPersistenceError.writeFailed
        }

        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String:
                kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        guard SecItemUpdate(
            query as CFDictionary,
            attributes as CFDictionary
        ) == errSecSuccess else {
            throw KeychainPersistenceError.writeFailed
        }
    }

    func delete(service: String, account: String) throws {
        let status = SecItemDelete(
            baseQuery(service: service, account: account) as CFDictionary
        )
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainPersistenceError.deleteFailed
        }
    }

    private func baseQuery(
        service: String,
        account: String
    ) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}

final class KeychainInstallationIdentifierStore:
    InstallationIdentifierProviding
{
    private let service = "com.zll.lifesnapaction.security"
    private let account = "app-check-installation-id-v1"
    private let keychain: KeychainPersisting
    private let lock = NSLock()

    init(keychain: KeychainPersisting = SystemKeychain()) {
        self.keychain = keychain
    }

    func identifier() throws -> String {
        lock.lock()
        defer { lock.unlock() }

        if let data = try keychain.read(service: service, account: account),
           let stored = String(data: data, encoding: .utf8),
           let uuid = UUID(uuidString: stored)
        {
            return uuid.uuidString.lowercased()
        }

        try keychain.delete(service: service, account: account)
        let created = UUID().uuidString.lowercased()
        try keychain.write(
            Data(created.utf8),
            service: service,
            account: account
        )
        return created
    }
}
