const { withAndroidManifest } = require("expo/config-plugins");

/**
 * Narrows permissions that are only needed on older Android releases.
 *
 * `expo-media-library` declares WRITE_EXTERNAL_STORAGE without a ceiling. The
 * app uses it only for `saveToLibraryAsync`, which needs that permission on
 * Android 9 and below; scoped storage makes it unnecessary from Android 10.
 * Declaring the ceiling keeps a modern install from asking for broad storage
 * access it cannot use.
 *
 * This plugin must run after the plugins that add the permission, which is why
 * it is last in app.json's plugin list.
 */

const MAX_SDK_VERSION = {
  "android.permission.WRITE_EXTERNAL_STORAGE": "28",
};

function withAndroidPermissionScopes(config) {
  return withAndroidManifest(config, (config) => {
    const permissions = config.modResults.manifest["uses-permission"] ?? [];
    for (const permission of permissions) {
      const name = permission.$?.["android:name"];
      if (name && MAX_SDK_VERSION[name]) {
        permission.$["android:maxSdkVersion"] = MAX_SDK_VERSION[name];
      }
    }
    return config;
  });
}

module.exports = withAndroidPermissionScopes;
