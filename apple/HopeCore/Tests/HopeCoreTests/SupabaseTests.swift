import Foundation
import Testing

@testable import HopeCore

/// Answers requests from a handler and records them.
final class FakeHTTP: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var _requests: [URLRequest] = []
    private let handler: @Sendable (URLRequest) -> (Int, String)

    init(_ handler: @escaping @Sendable (URLRequest) -> (Int, String)) { self.handler = handler }

    var requests: [URLRequest] { lock.withLock { _requests } }

    func send(_ request: URLRequest) async throws -> (status: Int, body: Data) {
        lock.withLock { _requests.append(request) }
        let (status, body) = handler(request)
        return (status, Data(body.utf8))
    }
}

let config = SupabaseConfig(url: "https://demo.supabase.co/", anonKey: "anon")!

func tokensJSON(access: String, refresh: String, user: String = "u1", email: String = "e@x.io") -> String {
    #"{"access_token":"\#(access)","token_type":"bearer","expires_in":3600,"expires_at":1,"refresh_token":"\#(refresh)","user":{"id":"\#(user)","email":"\#(email)","aud":"authenticated"}}"#
}

func bodyJSON(_ r: URLRequest) -> Any? { r.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) } }

@Suite("Supabase HTTP")
struct SupabaseHTTPTests {
    @Test func authErrorsMapToCodes() {
        func code(_ status: Int, _ body: String, refreshing: Bool = false) -> SyncErrorCode {
            AuthAPI.authError(status: status, body: Data(body.utf8), refreshing: refreshing).code
        }
        #expect(code(400, #"{"code":400,"error_code":"invalid_credentials","msg":"Invalid login credentials"}"#) == .invalidCredentials)
        #expect(code(400, #"{"error":"invalid_grant","error_description":"Invalid login credentials"}"#) == .invalidCredentials)
        #expect(code(400, #"{"error_code":"email_not_confirmed","msg":"Email not confirmed"}"#) == .emailNotConfirmed)
        #expect(code(422, #"{"error_code":"user_already_exists"}"#) == .userAlreadyExists)
        #expect(code(422, #"{"error_code":"weak_password"}"#) == .weakPassword)
        #expect(code(429, "") == .rateLimited)
        #expect(code(400, #"{"error_code":"refresh_token_not_found"}"#, refreshing: true) == .sessionExpired)
        #expect(code(502, "<html>") == .server)
    }

    @Test func tokenResponseParses() throws {
        let t = try AuthAPI.parseTokens(Data(tokensJSON(access: "a", refresh: "r", user: "u").utf8))
        #expect(t.accessToken == "a" && t.refreshToken == "r" && t.user.id == "u" && t.expiresIn == 3600)
    }

    @Test func configIgnoresUnexpandedOrEmptyValues() {
        #expect(config.url == "https://demo.supabase.co")
        #expect(SupabaseConfig(url: "$(SUPABASE_URL)", anonKey: "k") == nil)
        #expect(SupabaseConfig(url: "", anonKey: "k") == nil)
        #expect(SupabaseConfig(url: "https://x.supabase.co", anonKey: " ") == nil)
    }

    @Test func authRequestsMatchTheDesktop() async throws {
        let http = FakeHTTP { r in
            r.url!.path.hasSuffix("/signup") ? (200, #"{"id":"u1","email":"e@x.io"}"#) : (200, tokensJSON(access: "a", refresh: "r"))
        }
        let api = AuthAPI(config: config, transport: http)
        _ = try await api.signIn(email: "e@x.io", password: "pw")
        #expect(try await api.signUp(email: "e@x.io", password: "pw") == .confirmEmail)
        _ = try await api.refresh("r0")
        await api.signOut(accessToken: "a")

        let r = http.requests
        #expect(r.map { $0.url!.absoluteString } == [
            "https://demo.supabase.co/auth/v1/token?grant_type=password",
            "https://demo.supabase.co/auth/v1/signup",
            "https://demo.supabase.co/auth/v1/token?grant_type=refresh_token",
            "https://demo.supabase.co/auth/v1/logout?scope=local",
        ])
        #expect(r.allSatisfy { $0.httpMethod == "POST" && $0.value(forHTTPHeaderField: "apikey") == "anon" })
        #expect(bodyJSON(r[0]) as? [String: String] == ["email": "e@x.io", "password": "pw"])
        #expect(bodyJSON(r[2]) as? [String: String] == ["refresh_token": "r0"])
        #expect(r[3].value(forHTTPHeaderField: "Authorization") == "Bearer a")
    }

    @MainActor
    @Test func postgrestRequestsMatchTheDesktop() async throws {
        let http = FakeHTTP { r in
            r.httpMethod == "GET" ? (200, "[]") : (200, String(decoding: r.httpBody!, as: UTF8.self))
        }
        let remote = SupabaseRemote(config: config, transport: http) { _ in "jwt" }
        let row: Row = ["date": "2026-10-03", "utc_offset_min": 480, "updated_ms": 5, "device_id": "d"]
        let back = try await remote.upsert(.day, rows: [row])
        _ = try await remote.fetch(.session, after: 950, limit: 1000)

        let up = http.requests[0]
        #expect(up.url!.absoluteString == "https://demo.supabase.co/rest/v1/day?on_conflict=user_id,date&columns=date,wake_ms,sleep_ms,utc_offset_min,updated_ms,deleted_ms,device_id")
        #expect(up.value(forHTTPHeaderField: "Prefer") == "resolution=merge-duplicates,return=representation")
        #expect(up.value(forHTTPHeaderField: "Authorization") == "Bearer jwt")
        #expect(up.value(forHTTPHeaderField: "apikey") == "anon")
        let sent = try #require(bodyJSON(up) as? [[String: Any]])
        #expect(Set(sent[0].keys) == Set(SyncTable.day.columns), "every column, nulls included")
        #expect(sent[0]["wake_ms"] is NSNull)
        #expect(back[0]["utc_offset_min"] == .int(480))

        let get = http.requests[1]
        #expect(get.httpMethod == "GET")
        #expect(get.url!.absoluteString == "https://demo.supabase.co/rest/v1/session?select=*&server_seq=gt.950&order=server_seq.asc&limit=1000")
    }

    @MainActor
    @Test func unauthorizedRefreshesOnceAndRetries() async throws {
        let http = FakeHTTP { r in
            r.value(forHTTPHeaderField: "Authorization") == "Bearer old" ? (401, "{}") : (200, "[]")
        }
        var forced: [Bool] = []
        let remote = SupabaseRemote(config: config, transport: http) { force in
            forced.append(force)
            return force ? "new" : "old"
        }
        _ = try await remote.fetch(.activity, after: 0, limit: 10)
        #expect(forced == [false, true])
        #expect(http.requests.count == 2)
    }
}

@MainActor
@Suite("Sync service")
struct SyncServiceTests {
    /// GoTrue that hands out numbered, rotating refresh tokens and rejects spent ones.
    final class Auth: @unchecked Sendable {
        let lock = NSLock()
        var issued = 0
        var live: Set<String> = []
        var user = "u1"
        func handle(_ r: URLRequest) -> (Int, String) {
            lock.withLock {
                let url = r.url!.absoluteString
                if url.hasSuffix("grant_type=refresh_token") {
                    let token = (bodyJSON(r) as? [String: String])?["refresh_token"] ?? ""
                    guard live.remove(token) != nil else { return (400, #"{"error_code":"refresh_token_already_used"}"#) }
                }
                if url.contains("/rest/v1/") { return (200, r.httpMethod == "GET" ? "[]" : String(decoding: r.httpBody!, as: UTF8.self)) }
                issued += 1
                live.insert("r\(issued)")
                return (200, tokensJSON(access: "a\(issued)", refresh: "r\(issued)", user: user))
            }
        }
    }

    @Test func signInStoresTheRefreshTokenAndSyncs() async throws {
        let auth = Auth()
        let db = try device("d")
        _ = try db.addActivity(1, "Work")
        let tokens = MemoryTokenStore()
        let sync = SyncService(store: db, config: config, transport: FakeHTTP(auth.handle), tokenStore: tokens)
        #expect(sync.phase == .signedOut)
        #expect(try await sync.signIn(email: "e@x.io", password: "pw") == .signedIn)
        #expect(tokens.load() == "r1")
        #expect(sync.phase == .syncing)
        try await sync.round(full: true)
        #expect(sync.phase == .synced)
        #expect(try db.dirtyCount() == 0)
        #expect(sync.email == "e@x.io")

        await sync.signOut()
        #expect(sync.phase == .signedOut && tokens.load() == nil)
        #expect(db.activities().count == 1, "signing out keeps local data")
        #expect(sync.email == "e@x.io", "the last account is remembered")
    }

    @Test func expiredAccessTokenIsRefreshedAndRotated() async throws {
        let auth = Auth()
        let db = try device("d")
        let tokens = MemoryTokenStore()
        let sync = SyncService(store: db, config: config, transport: FakeHTTP(auth.handle), tokenStore: tokens)
        _ = try await sync.signIn(email: "e@x.io", password: "pw")
        db.clock = { Int64(Date().timeIntervalSince1970 * 1000) + 3_600_000 }  // an hour later
        #expect(try await sync.accessToken(force: false) == "a2")
        #expect(tokens.load() == "r2", "the rotated refresh token replaces the spent one")
        // Two callers at once share one refresh (a second refresh with r2 would be rejected).
        async let x = sync.accessToken(force: true)
        async let y = sync.accessToken(force: true)
        let both = try await [x, y]
        #expect(both == ["a3", "a3"])
    }

    @Test func rejectedRefreshSignsOut() async throws {
        let auth = Auth()
        let db = try device("d")
        let tokens = MemoryTokenStore("spent")
        try db.saveSettings([LocalStore.Setting.userId: "u1"])
        let sync = SyncService(store: db, config: config, transport: FakeHTTP(auth.handle), tokenStore: tokens)
        #expect(sync.isSignedIn, "restored from the keychain")
        await #expect(throws: SyncError(.signedOut, "session expired")) { try await sync.round(full: true) }
        #expect(sync.phase == .signedOut)
        #expect(sync.lastError?.code == .sessionExpired)
        #expect(tokens.load() == nil)
    }

    @Test func anotherAccountNeedsConfirmation() async throws {
        let auth = Auth()
        let db = try device("d")
        let sync = SyncService(store: db, config: config, transport: FakeHTTP(auth.handle), tokenStore: MemoryTokenStore())
        _ = try await sync.signIn(email: "e@x.io", password: "pw")
        try await sync.round(full: true)
        await sync.signOut()

        auth.user = "u2"
        #expect(try await sync.signIn(email: "f@x.io", password: "pw") == .confirmSwitch(previousEmail: "e@x.io"))
        #expect(!sync.isSignedIn)
        _ = try db.addActivity(1, "Work")
        try db.write { for a in db.activities() { a.dirty = false } }
        #expect(try await sync.signIn(email: "f@x.io", password: "pw", confirmSwitch: true) == .signedIn)
        #expect(try db.dirtyCount() == 1, "every local row is offered to the new account")
    }

    @Test func watchAdoptsAHandoffOnce() async throws {
        let auth = Auth()
        let phoneDB = try device("phone")
        let watchDB = try device("watch")
        let phone = SyncService(store: phoneDB, config: config, transport: FakeHTTP(auth.handle), tokenStore: MemoryTokenStore())
        let watchTokens = MemoryTokenStore()
        let watch = SyncService(store: watchDB, config: config, transport: FakeHTTP(auth.handle), tokenStore: watchTokens)

        _ = try await phone.signIn(email: "e@x.io", password: "pw")
        let handoff = try await phone.makeHandoff(email: "e@x.io", password: "pw")
        #expect(handoff.tokens?.refreshToken == "r2", "the watch gets its own session, not the phone's")

        await watch.adopt(handoff)
        #expect(watch.isSignedIn && watchTokens.load() == "r2")
        await watch.signOut()
        await watch.adopt(handoff)
        #expect(!watch.isSignedIn, "the same handoff is applied only once")

        await watch.adopt(SessionHandoff(tokens: try await phone.makeHandoff(email: "e@x.io", password: "pw").tokens))
        #expect(watch.isSignedIn)
        await watch.adopt(SessionHandoff(tokens: nil))
        #expect(!watch.isSignedIn, "the phone signed out")
    }

    @Test func notConfiguredStaysLocal() async throws {
        let db = try device("d")
        let sync = SyncService(store: db, config: nil, transport: FakeHTTP { _ in (500, "") }, tokenStore: MemoryTokenStore("x"))
        #expect(sync.phase == .notConfigured)
        await #expect(throws: SyncError(.notConfigured, "no Supabase config in this build")) {
            _ = try await sync.signIn(email: "e", password: "p")
        }
    }

    @Test func backoffDoublesUpToAMinute() {
        let secs = (1...7).map { SyncService.backoff(failures: $0).components.seconds }
        #expect(secs == [5, 10, 20, 40, 60, 60, 60])
    }
}
