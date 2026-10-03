import HopeCore
import SwiftUI

/// Sign in / create account / sign out — the only setting in stage 8 (rebuild-plan 12.4).
struct AccountView: View {
    @Environment(AppModel.self) private var model
    @Environment(PhoneLink.self) private var watch
    @Environment(\.dismiss) private var dismiss

    @State private var email = ""
    @State private var password = ""
    @State private var busy = false
    @State private var error: String?
    @State private var note: String?
    /// Set while asking whether to merge this device into a different account.
    @State private var pendingSwitch: PendingSwitch?
    @State private var askWatchPassword = false
    @State private var watchPassword = ""

    struct PendingSwitch: Identifiable {
        var id: String { email }
        var email: String
        var password: String
        var previous: String?
        var signUp: Bool
    }

    var body: some View {
        let sync = model.sync
        NavigationStack {
            Form {
                switch sync.phase {
                case .notConfigured:
                    Section {
                        LabeledContent("Status") { Text("Not configured") }
                    } footer: {
                        Text("This build has no sync server, so everything stays on this iPhone. See apple/README.md to turn sync on.")
                    }
                case .signedOut:
                    signedOutSection
                default:
                    signedInSection(sync)
                }
                if let error {
                    Section { Text(verbatim: error).foregroundStyle(.red) }
                }
                if let note {
                    Section { Text(verbatim: note).foregroundStyle(.secondary) }
                }
            }
            .navigationTitle("Account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .disabled(busy)
            .alert(
                "Use a Different Account?", isPresented: Binding(get: { pendingSwitch != nil }, set: { if !$0 { pendingSwitch = nil } }),
                presenting: pendingSwitch
            ) { p in
                Button("Merge") { Task { await submit(email: p.email, password: p.password, signUp: p.signUp, confirmSwitch: true) } }
                Button("Cancel", role: .cancel) {}
            } message: { p in
                Text("This device last synced with \(p.previous ?? String(localized: "another account")). Its records will be merged into \(p.email). Nothing is deleted.")
            }
            .alert("Connect Apple Watch", isPresented: $askWatchPassword) {
                SecureField("Password", text: $watchPassword)
                Button("Connect") { Task { await connectWatch() } }
                Button("Cancel", role: .cancel) { watchPassword = "" }
            } message: {
                Text("Enter your password once more so the watch gets its own sign-in.")
            }
        }
    }

    private var signedOutSection: some View {
        Section {
            TextField("Email", text: $email)
                .textContentType(.username)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            SecureField("Password", text: $password)
                .textContentType(.password)
            Button("Sign In") { Task { await submit(email: email, password: password, signUp: false) } }
                .disabled(email.isEmpty || password.isEmpty)
            Button("Create Account") { Task { await submit(email: email, password: password, signUp: true) } }
                .disabled(email.isEmpty || password.isEmpty)
        } footer: {
            Text("Records on this device are merged into the account.")
        }
    }

    @ViewBuilder
    private func signedInSection(_ sync: SyncService) -> some View {
        Section {
            LabeledContent("Account") { Text(verbatim: sync.email ?? "") }
            LabeledContent("Status") { statusText(sync) }
            Button("Sync Now") { sync.syncNow() }
            if watch.watchAvailable {
                Button("Connect Apple Watch") { askWatchPassword = true }
            }
        } footer: {
            if let e = sync.lastError, sync.phase == .error { Text(verbatim: message(for: e)) }
        }
        Section {
            Button("Sign Out", role: .destructive) {
                Task {
                    await sync.signOut()
                    watch.send(SessionHandoff(tokens: nil))
                    note = String(localized: "Signed out. Your records stay on this device.")
                }
            }
        } footer: {
            Text("Signing out keeps everything on this device.")
        }
    }

    private func statusText(_ sync: SyncService) -> Text {
        switch sync.phase {
        case .syncing: Text("Syncing…")
        case .error: Text("Can't sync right now")
        default:
            if let ms = sync.lastOkMs {
                Text("Last synced \(Date(timeIntervalSince1970: Double(ms) / 1000), format: .dateTime.hour().minute())")
            } else {
                Text("Syncing…")
            }
        }
    }

    private func submit(email: String, password: String, signUp: Bool, confirmSwitch: Bool = false) async {
        busy = true
        error = nil
        note = nil
        defer { busy = false }
        do {
            let outcome = signUp
                ? try await model.sync.signUp(email: email, password: password, confirmSwitch: confirmSwitch)
                : try await model.sync.signIn(email: email, password: password, confirmSwitch: confirmSwitch)
            switch outcome {
            case .signedIn:
                if watch.watchAvailable { await handOff(email: email, password: password) }
                self.password = ""
            case .confirmSwitch(let previous):
                pendingSwitch = PendingSwitch(email: email, password: password, previous: previous, signUp: signUp)
            case .checkEmail:
                note = String(localized: "Check \(email) for a confirmation link, then sign in here.")
            }
        } catch let e as SyncError {
            error = message(for: e)
        } catch {
            self.error = String(describing: error)
        }
    }

    /// The watch gets its own session: a second sign-in with the same password (see `SessionHandoff`).
    private func handOff(email: String, password: String) async {
        do {
            watch.send(try await model.sync.makeHandoff(email: email, password: password))
        } catch let e as SyncError {
            error = message(for: e)
        } catch {
            self.error = String(describing: error)
        }
    }

    private func connectWatch() async {
        let password = watchPassword
        watchPassword = ""
        guard let email = model.sync.email else { return }
        busy = true
        defer { busy = false }
        await handOff(email: email, password: password)
        if error == nil { note = String(localized: "Sent to Apple Watch.") }
    }
}
