import Foundation
import Security

/// Where the refresh token lives (rebuild-plan 12.4: the system keychain; the access token stays in memory).
public protocol TokenStore: Sendable {
    func load() -> String?
    func save(_ token: String) throws
    func delete()
}

/// A generic-password item in this app's own keychain access group. No entitlement needed; readable after
/// the first unlock so background refreshes work.
public struct KeychainTokenStore: TokenStore {
    let service: String
    let account: String

    public init(service: String = "io.github.dan9574.hope", account: String = "supabase-refresh-token") {
        self.service = service
        self.account = account
    }

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    public func load() -> String? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    public func save(_ token: String) throws {
        let data = Data(token.utf8)
        let attrs: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        var status = SecItemUpdate(query as CFDictionary, attrs as CFDictionary)
        if status == errSecItemNotFound {
            var add = query
            add.merge(attrs) { _, new in new }
            status = SecItemAdd(add as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw SyncError(.keychain, "keychain status \(status)") }
    }

    public func delete() {
        SecItemDelete(query as CFDictionary)
    }
}

/// For tests and previews.
public final class MemoryTokenStore: TokenStore, @unchecked Sendable {
    private let lock = NSLock()
    private var token: String?

    public init(_ token: String? = nil) { self.token = token }

    public func load() -> String? { lock.withLock { token } }
    public func save(_ token: String) throws { lock.withLock { self.token = token } }
    public func delete() { lock.withLock { token = nil } }
}
