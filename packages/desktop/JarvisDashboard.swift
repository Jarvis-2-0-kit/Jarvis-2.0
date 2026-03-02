import Cocoa
import WebKit

class AppDelegate: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    var webView: WKWebView!

    func applicationDidFinishLaunching(_ notification: Notification) {
        // WebView config — allow local storage, JS, etc.
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        config.defaultWebpagePreferences.allowsContentJavaScript = true

        // Persistent data store (cookies, localStorage survive restarts)
        let dataStore = WKWebsiteDataStore.default()
        config.websiteDataStore = dataStore

        webView = WKWebView(frame: .zero, configuration: config)
        webView.allowsBackForwardNavigationGestures = true
        webView.customUserAgent = "JarvisDashboard/1.0 Safari/605"

        // Window setup
        let screenFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let windowWidth: CGFloat = min(1440, screenFrame.width * 0.85)
        let windowHeight: CGFloat = min(900, screenFrame.height * 0.85)
        let windowX = screenFrame.origin.x + (screenFrame.width - windowWidth) / 2
        let windowY = screenFrame.origin.y + (screenFrame.height - windowHeight) / 2

        let windowFrame = NSRect(x: windowX, y: windowY, width: windowWidth, height: windowHeight)

        window = NSWindow(
            contentRect: windowFrame,
            styleMask: [.titled, .closable, .resizable, .miniaturizable],
            backing: .buffered,
            defer: false
        )

        window.title = "Jarvis 2.0 Dashboard"
        window.backgroundColor = NSColor(red: 0.06, green: 0.06, blue: 0.09, alpha: 1.0)
        window.minSize = NSSize(width: 800, height: 600)

        // Dark titlebar
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .visible
        if let appearance = NSAppearance(named: .darkAqua) {
            window.appearance = appearance
        }

        window.contentView = webView
        window.makeKeyAndOrderFront(nil)

        // Load gateway URL
        let gatewayPort = ProcessInfo.processInfo.environment["JARVIS_PORT"] ?? "18900"
        let urlString = "http://localhost:\(gatewayPort)"

        if let url = URL(string: urlString) {
            webView.load(URLRequest(url: url))
        }

        // Auto-reload on wake from sleep (reconnect WebSocket)
        NSWorkspace.shared.notificationCenter.addObserver(
            self,
            selector: #selector(handleWake),
            name: NSWorkspace.didWakeNotification,
            object: nil
        )

        NSApp.activate(ignoringOtherApps: true)
    }

    @objc func handleWake() {
        // Give network a moment to reconnect, then reload
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
            self?.webView.reload()
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }
}

// --- Entry point ---
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
