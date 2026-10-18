import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

// Defined in an existing target source file so both Xcode and SPM include it.
import Security

class MobileBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(MonoCodeCredentialsPlugin())
    }
}

@objc(MonoCodeCredentialsPlugin)
public class MonoCodeCredentialsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MonoCodeCredentialsPlugin"
    public let jsName = "MonoCodeCredentials"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise)
    ]
    private func query(_ call: CAPPluginCall) -> [String: Any]? {
        guard let key = call.getString("key"), ["connection", "connections", "pending", "installationId"].contains(key) else {
            call.reject("Invalid storage key")
            return nil
        }
        return [kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: "com.monocode.mobile.credentials",
                kSecAttrAccount as String: key]
    }
    @objc func get(_ call: CAPPluginCall) {
        guard var query = query(call) else { return }
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { call.resolve(); return }
        guard status == errSecSuccess, let data = result as? Data,
              let value = String(data: data, encoding: .utf8) else {
            call.reject("Unable to read secure storage (\(status))")
            return
        }
        call.resolve(["value": value])
    }
    @objc func set(_ call: CAPPluginCall) {
        guard let query = query(call), let value = call.getString("value") else {
            call.reject("Missing storage value")
            return
        }
        let attributes: [String: Any] = [kSecValueData as String: Data(value.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil)
        }
        if status == errSecSuccess { call.resolve() }
        else { call.reject("Unable to save secure storage (\(status))") }
    }
    @objc func remove(_ call: CAPPluginCall) {
        guard let query = query(call) else { return }
        let status = SecItemDelete(query as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound { call.resolve() }
        else { call.reject("Unable to remove secure storage (\(status))") }
    }
}
