import UserNotifications

/// The one `UNUserNotificationCenter` delegate of each app. Reminders register their category here with a
/// handler for its actions; the router shows banners while the app is in front and hands an action (which
/// may have started the app in the background) to whoever owns its category.
@MainActor
final class NotificationRouter: NSObject {
    static let shared = NotificationRouter()

    typealias Handler = @MainActor (_ action: String, _ request: String) async -> Void

    private var handlers: [String: Handler] = [:]
    private var categories: Set<UNNotificationCategory> = []

    /// Registers (or replaces) the handler for `category` and pushes the full category set to the system.
    func register(_ category: UNNotificationCategory, handler: @escaping Handler) {
        handlers[category.identifier] = handler
        categories = categories.filter { $0.identifier != category.identifier }
        categories.insert(category)
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.setNotificationCategories(categories)
    }

    private func dispatch(category: String, action: String, request: String) async {
        await handlers[category]?(action, request)
    }
}

extension NotificationRouter: UNUserNotificationCenterDelegate {
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let category = response.notification.request.content.categoryIdentifier
        let action = response.actionIdentifier
        let request = response.notification.request.identifier
        await dispatch(category: category, action: action, request: request)
    }
}
