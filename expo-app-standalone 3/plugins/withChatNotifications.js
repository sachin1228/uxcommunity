const fs = require("fs");
const path = require("path");
const {
  AndroidConfig,
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
} = require("expo/config-plugins");

/**
 * Installs ChatFirebaseMessagingService, which draws community chat pushes
 * (community DP on the left) from data-only FCM messages.
 *
 * It replaces expo-notifications' FCM service declaration with a subclass.
 * Every non-direct message is passed to `super`, so Expo keeps handling iOS
 * (not affected here), DMs, activity and event pushes unchanged.
 */

const SERVICE_NAME = ".ChatFirebaseMessagingService";
const EXPO_SERVICE =
  "expo.modules.notifications.service.ExpoFirebaseMessagingService";
const SOURCES = [
  "ChatFirebaseMessagingService.kt",
  "ChatNotificationStateModule.kt",
  "ChatNotificationStatePackage.kt",
].map((file) => path.join(__dirname, "chat-notifications", file));
const PACKAGE_DIR = path.join("android", "app", "src", "main", "java", "in", "uxcommunity", "app");

function withChatNotificationSource(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const targetDir = path.join(config.modRequest.projectRoot, PACKAGE_DIR);
      fs.mkdirSync(targetDir, { recursive: true });
      for (const source of SOURCES) {
        fs.copyFileSync(source, path.join(targetDir, path.basename(source)));
      }
      // Register the active-chat bridge next to the generated packages.
      const mainApplication = path.join(targetDir, "MainApplication.kt");
      if (fs.existsSync(mainApplication)) {
        const original = fs.readFileSync(mainApplication, "utf8");
        if (!original.includes("ChatNotificationStatePackage()")) {
          fs.writeFileSync(
            mainApplication,
            original.replace(
              /PackageList\(this\)\.packages\.apply\s*\{/,
              "PackageList(this).packages.apply {\n              add(ChatNotificationStatePackage())",
            ),
          );
        }
      }
      return config;
    },
  ]);
}

function withChatNotificationManifest(config) {
  return withAndroidManifest(config, (config) => {
    const application =
      AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    application.service = application.service ?? [];
    application.service = application.service.filter(
      (service) => service.$?.["android:name"] !== EXPO_SERVICE,
    );
    if (
      !application.service.some(
        (service) => service.$?.["android:name"] === SERVICE_NAME,
      )
    ) {
      application.service.push({
        $: { "android:name": SERVICE_NAME, "android:exported": "false" },
        "intent-filter": [
          {
            action: [
              { $: { "android:name": "com.google.firebase.MESSAGING_EVENT" } },
            ],
          },
        ],
      });
    }
    return config;
  });
}

function withFirebaseMessagingDependency(config) {
  return withAppBuildGradle(config, (config) => {
    const contents = config.modResults.contents;
    if (!contents.includes("com.google.firebase:firebase-messaging")) {
      config.modResults.contents = contents.replace(
        /dependencies\s*\{/,
        'dependencies {\n    implementation("com.google.firebase:firebase-messaging:24.0.1")\n',
      );
    }
    return config;
  });
}

module.exports = function withChatNotifications(config) {
  config = withChatNotificationSource(config);
  config = withFirebaseMessagingDependency(config);
  return withChatNotificationManifest(config);
};
