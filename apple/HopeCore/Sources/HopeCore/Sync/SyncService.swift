import Foundation
import Network
import Observation

public enum SyncPhase: Sendable, Equatable {
    /// This build has no Supabase project.
    case notConfigured
    case signedOut
    /// Signed in; the first round since launch / sign-in has not finished yet.
    case syncing
    /// Up to date as of `lastOkMs`.
    case synced
    /// The last round failed; retrying with backoff.
    case error
}

public enum SignInOutcome: Sendable, Equatable {
    case signedIn
    /// This device last synced a different account. Nothing was stored; call again with `confirmSwitch`
    /// after asking the user. Local data is then merged into the new account.
    case confirmSwitch(previousEmail: String?)
    /// Sign-up needs the emailed link clicked before signing in.
    case checkEmail
}

/// A sign-in passed from the iPhone to the watch over WatchConnectivity (rebuild-plan 12.7).
///
/// Supabase refresh tokens rotate and reusing a spent one revokes the whole session, so the phone does not
/// share its own session: at sign-in it signs in a second time and hands that session to the watch, which
/// then refreshes it on its own. `tokens == nil` means the phone signed out.
public struct SessionHandoff: Codable, Sendable, Equatable {
    public var id: String
    public var tokens: AuthTokens?

    public init(id: String = UUID().uuidString, tokens: AuthTokens?) {
        self.id = id
        self.tokens = tokens
    }
}

/// Sign-in state, the refresh token in the keychain, and the background schedule (rebuild-plan 12.3 / 12.4);
/// a port of `src-tauri/src/sync/mod.rs`. Without a Supabase config nothing here runs and the app is local-only.
@MainActor
@Observable
public final class SyncService {
    public let config: SupabaseConfig?
    @ObservationIgnored let store: LocalStore
    @ObservationIgnored let transport: any HTTPTransport
    @ObservationIgnored let tokenStore: any TokenStore
    /// Tests replace the HTTP remote with the fake server.
    @ObservationIgnored var remoteOverride: (any SyncRemote)?

    struct AuthSession {
        var userId: String
        var email: String?
        var refreshToken: String
        var accessToken: String?
        var expiresAtMs: Int64
    }

    private var auth: AuthSession?
    private var syncedOnce = false
    public private(set) var lastOkMs: Int64?
    public private(set) var lastError: SyncError?
    @ObservationIgnored private var lastOkSavedMs: Int64 = 0
    @ObservationIgnored private var refreshTask: Task<AuthTokens, any Error>?
    @ObservationIgnored private var inbox: AsyncStream<Message>.Continuation?
    @ObservationIgnored private var loop: Task<Void, Never>?
    @ObservationIgnored private var monitor: NWPathMonitor?
    @ObservationIgnored private var pathSatisfied: Bool?

    static let pullEvery: Duration = .seconds(5)
    static let pushDebounce: Duration = .milliseconds(500)
    static let maxBackoffSeconds: Int64 = 60
    /// Refresh the access token this long before it expires.
    static let tokenMarginMs: Int64 = 60_000
    /// `sync.last_ok_ms` is written at most this often (the in-memory value is always current).
    static let lastOkSaveMs: Int64 = 30_000

    enum Message: Sendable { case localWrite, syncNow, tick }

    public init(
        store: LocalStore, config: SupabaseConfig?, transport: any HTTPTransport = URLSessionTransport(),
        tokenStore: any TokenStore = KeychainTokenStore()
    ) {
        self.store = store
        self.config = config
        self.transport = transport
        self.tokenStore = tokenStore
        let lastOk = store.setting(LocalStore.Setting.lastOk).flatMap { Int64($0) }
        lastOkMs = lastOk
        lastOkSavedMs = lastOk ?? 0
        // Only touch the keychain when this device has signed in before.
        if config != nil, let userId = store.setting(LocalStore.Setting.userId), let refresh = tokenStore.load() {
            auth = AuthSession(
                userId: userId, email: store.setting(LocalStore.Setting.email), refreshToken: refresh,
                accessToken: nil, expiresAtMs: 0)
        }
    }

    // MARK: Status

    public var phase: SyncPhase {
        if config == nil { return .notConfigured }
        guard auth != nil else { return .signedOut }
        if lastError != nil { return .error }
        return syncedOnce ? .synced : .syncing
    }

    public var isSignedIn: Bool { auth != nil }

    /// The signed-in account, or the last one used on this device when signed out.
    public var email: String? {
        auth?.email ?? store.setting(LocalStore.Setting.email)
    }

    var userId: String? { auth?.userId }

    // MARK: Schedule

    /// Starts the background loop (and the network monitor). Call once at launch; no-op without a config.
    public func start() {
        guard config != nil, loop == nil else { return }
        let (stream, continuation) = AsyncStream.makeStream(of: Message.self)
        inbox = continuation
        store.onLocalWrite = { [weak self] in self?.send(.localWrite) }
        loop = Task { [weak self] in await self?.run(stream) }
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            let satisfied = path.status == .satisfied
            Task { @MainActor in self?.pathChanged(satisfied: satisfied) }
        }
        monitor.start(queue: DispatchQueue(label: "hope.sync.path"))
        self.monitor = monitor
    }

    /// A full round when the connection comes back (rebuild-plan 12.3).
    private func pathChanged(satisfied: Bool) {
        if satisfied && pathSatisfied == false { syncNow() }
        pathSatisfied = satisfied
    }

    /// A full push + pull as soon as possible (launch, foreground, pull-to-refresh).
    public func syncNow() { send(.syncNow) }

    private func send(_ message: Message) { inbox?.yield(message) }

    static func backoff(failures: Int) -> Duration {
        let factor = Int64(1) << Int64(min(max(failures - 1, 0), 5))
        return .seconds(min(5 * factor, maxBackoffSeconds))
    }

    private func run(_ stream: AsyncStream<Message>) async {
        let clock = ContinuousClock()
        var iterator = stream.makeAsyncIterator()
        var nextFull: ContinuousClock.Instant? = clock.now  // full round at start
        var pushAt: ContinuousClock.Instant?
        var failures = 0
        while !Task.isCancelled {
            let deadline = [nextFull, pushAt].compactMap { $0 }.min()
            let timer = deadline.map { d in
                Task { [inbox] in
                    try? await Task.sleep(until: d, clock: clock)
                    if !Task.isCancelled { inbox?.yield(.tick) }
                }
            }
            guard let message = await iterator.next() else { return }
            timer?.cancel()
            switch message {
            case .localWrite:
                // While backing off, the retry will carry the change.
                if failures == 0 && isSignedIn { pushAt = clock.now + Self.pushDebounce }
                continue
            case .syncNow:
                nextFull = clock.now
                failures = 0
                continue
            case .tick:
                break
            }
            let now = clock.now
            let full = nextFull.map { $0 <= now } ?? false
            let pushDue = pushAt.map { $0 <= now } ?? false
            guard full || pushDue else { continue }  // a stale tick
            guard isSignedIn else {
                // Sleep until sign-in sends syncNow.
                nextFull = nil
                pushAt = nil
                failures = 0
                continue
            }
            pushAt = nil
            do {
                try await round(full: full)
                failures = 0
                if full { nextFull = clock.now + Self.pullEvery }
            } catch let e as SyncError where e.code == .signedOut {
                // Signed out meanwhile; nothing to retry.
            } catch {
                failures += 1
                nextFull = clock.now + Self.backoff(failures: failures)
                print("sync: \(error) (retrying in \(Self.backoff(failures: failures)))")
            }
        }
    }

    func makeRemote() -> any SyncRemote {
        if let remoteOverride { return remoteOverride }
        return SupabaseRemote(config: config!, transport: transport) { [weak self] force in
            guard let self else { throw SyncError(.signedOut, "gone") }
            return try await self.accessToken(force: force)
        }
    }

    /// One round: push, plus pull when `full`.
    func round(full: Bool) async throws {
        guard config != nil else { throw SyncError(.notConfigured, "no Supabase config in this build") }
        guard isSignedIn else { throw SyncError(.signedOut, "not signed in") }
        let remote = makeRemote()
        do {
            if full {
                try await SyncEngine.sync(store, remote)
            } else {
                try await SyncEngine.push(store, remote)
            }
            recordOk()
        } catch let e as SyncError where e.code == .signedOut {
            throw e
        } catch let e as SyncError where e.code == .sessionExpired {
            sessionExpired(e)
            throw SyncError(.signedOut, "session expired")
        } catch {
            let e = error as? SyncError ?? SyncError(.database, String(describing: error))
            lastError = e
            try? store.saveSettings([LocalStore.Setting.lastError: e.description])
            throw e
        }
    }

    private func recordOk() {
        let now = store.now
        let clearError = lastError != nil
        lastError = nil
        syncedOnce = true
        lastOkMs = now
        if now - lastOkSavedMs >= Self.lastOkSaveMs || clearError {
            lastOkSavedMs = now
            var changes: [String: String?] = [LocalStore.Setting.lastOk: String(now)]
            if clearError { changes[LocalStore.Setting.lastError] = .some(nil) }
            try? store.saveSettings(changes)
        }
    }

    // MARK: Tokens

    /// A valid access token, refreshed when about to expire or when `force` is set. Concurrent callers
    /// share one refresh: refresh tokens rotate, so two refreshes with the same token would fail.
    func accessToken(force: Bool) async throws -> String {
        guard let a = auth else { throw SyncError(.signedOut, "not signed in") }
        if !force, let token = a.accessToken, a.expiresAtMs - Self.tokenMarginMs > store.now { return token }
        if let refreshTask { return try await refreshTask.value.accessToken }
        guard let config else { throw SyncError(.notConfigured, "no Supabase config in this build") }
        let api = AuthAPI(config: config, transport: transport)
        let refreshToken = a.refreshToken
        let task = Task { try await api.refresh(refreshToken) }
        refreshTask = task
        defer { refreshTask = nil }
        let tokens = try await task.value
        // Signed out (or into another account) while the request was in flight.
        guard var current = auth, current.userId == a.userId else { throw SyncError(.signedOut, "signed out during refresh") }
        // The old refresh token is now spent, so the keychain must get the new one.
        do { try tokenStore.save(tokens.refreshToken) } catch { print("sync: could not store the refreshed token: \(error)") }
        current.refreshToken = tokens.refreshToken
        current.accessToken = tokens.accessToken
        current.expiresAtMs = store.now + tokens.expiresIn * 1000
        auth = current
        return tokens.accessToken
    }

    /// The refresh token was rejected: drop the session so the user signs in again.
    private func sessionExpired(_ error: SyncError) {
        auth = nil
        tokenStore.delete()
        lastError = error
    }

    // MARK: Sign-in

    private func api() throws -> AuthAPI {
        guard let config else { throw SyncError(.notConfigured, "no Supabase config in this build") }
        return AuthAPI(config: config, transport: transport)
    }

    public func signIn(email: String, password: String, confirmSwitch: Bool = false) async throws -> SignInOutcome {
        let tokens = try await api().signIn(email: email.trimmingCharacters(in: .whitespaces), password: password)
        return try establish(tokens, confirmSwitch: confirmSwitch)
    }

    public func signUp(email: String, password: String, confirmSwitch: Bool = false) async throws -> SignInOutcome {
        switch try await api().signUp(email: email.trimmingCharacters(in: .whitespaces), password: password) {
        case .signedIn(let tokens): return try establish(tokens, confirmSwitch: confirmSwitch)
        case .confirmEmail: return .checkEmail
        }
    }

    func establish(_ tokens: AuthTokens, confirmSwitch: Bool) throws -> SignInOutcome {
        let userId = tokens.user.id
        let previous = store.setting(LocalStore.Setting.userId)
        if let previous, previous != userId, !confirmSwitch {
            return .confirmSwitch(previousEmail: store.setting(LocalStore.Setting.email))
        }
        try tokenStore.save(tokens.refreshToken)
        try store.applyRemote(changed: { _ in previous != userId }) {
            if previous != userId {
                // First sign-in here, or another account: offer every local row to it and pull from scratch.
                try SyncEngine.resetForNewAccount(store)
            }
            try store.setSetting(LocalStore.Setting.userId, userId)
            try store.setSetting(LocalStore.Setting.email, tokens.user.email)
            try store.setSetting(LocalStore.Setting.lastError, nil)
        }
        auth = AuthSession(
            userId: userId, email: tokens.user.email, refreshToken: tokens.refreshToken,
            accessToken: tokens.accessToken, expiresAtMs: store.now + tokens.expiresIn * 1000)
        lastError = nil
        syncedOnce = false
        syncNow()
        return .signedIn
    }

    /// Signs out on this device. Local data stays; the account is remembered to detect a switch later.
    public func signOut() async {
        let session = auth
        auth = nil
        tokenStore.delete()
        lastError = nil
        try? store.saveSettings([LocalStore.Setting.lastError: String?.none])
        if let token = session?.accessToken, let api = try? api() {
            await api.signOut(accessToken: token)
        }
    }

    // MARK: iPhone → Watch

    /// iPhone: a second, independent session for the watch (see `SessionHandoff`).
    public func makeHandoff(email: String, password: String) async throws -> SessionHandoff {
        let tokens = try await api().signIn(email: email.trimmingCharacters(in: .whitespaces), password: password)
        return SessionHandoff(tokens: tokens)
    }

    /// Watch: applies a handoff from the phone once. The phone already asked about switching accounts.
    public func adopt(_ handoff: SessionHandoff) async {
        guard config != nil, store.setting(LocalStore.Setting.handoffId) != handoff.id else { return }
        try? store.saveSettings([LocalStore.Setting.handoffId: handoff.id])
        if let tokens = handoff.tokens {
            if let old = auth?.accessToken, let api = try? api() { await api.signOut(accessToken: old) }
            do { _ = try establish(tokens, confirmSwitch: true) } catch { lastError = error as? SyncError }
        } else if isSignedIn {
            await signOut()
        }
    }
}
