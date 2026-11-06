const fs = require("fs");
const path = require("path");
const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
} = require("expo/config-plugins");

/**
 * Android app-data backup policy.
 *
 * The app stores chat history and the auth snapshot in AsyncStorage, which is
 * plaintext app data. Backups and device-to-device transfer must not carry it:
 * `allowBackup=false` disables cloud backup/restore, and the extraction rules
 * exclude every app-data domain as defence in depth for Android 12+ transfer.
 *
 * This lives in a config plugin (not only app.json) so a future `expo prebuild`
 * cannot silently regenerate a manifest with backups re-enabled.
 */

const BACKUP_RULES = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
  <exclude domain="root" path="." />
  <exclude domain="file" path="." />
  <exclude domain="database" path="." />
  <exclude domain="sharedpref" path="." />
  <exclude domain="external" path="." />
  <exclude domain="device_root" path="." />
  <exclude domain="device_file" path="." />
  <exclude domain="device_database" path="." />
  <exclude domain="device_sharedpref" path="." />
</full-backup-content>
`;

const DATA_EXTRACTION_RULES = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
    <exclude domain="root" path="." />
    <exclude domain="file" path="." />
    <exclude domain="database" path="." />
    <exclude domain="sharedpref" path="." />
    <exclude domain="external" path="." />
    <exclude domain="device_root" path="." />
    <exclude domain="device_file" path="." />
    <exclude domain="device_database" path="." />
    <exclude domain="device_sharedpref" path="." />
  </cloud-backup>
  <device-transfer>
    <exclude domain="root" path="." />
    <exclude domain="file" path="." />
    <exclude domain="database" path="." />
    <exclude domain="sharedpref" path="." />
    <exclude domain="external" path="." />
    <exclude domain="device_root" path="." />
    <exclude domain="device_file" path="." />
    <exclude domain="device_database" path="." />
    <exclude domain="device_sharedpref" path="." />
  </device-transfer>
</data-extraction-rules>
`;

function withBackupManifest(config) {
  return withAndroidManifest(config, (config) => {
    const application =
      AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    application.$["android:allowBackup"] = "false";
    application.$["android:fullBackupContent"] = "@xml/backup_rules";
    application.$["android:dataExtractionRules"] = "@xml/data_extraction_rules";
    return config;
  });
}

function withBackupRules(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const xmlDir = path.join(
        config.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "res",
        "xml",
      );
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(path.join(xmlDir, "backup_rules.xml"), BACKUP_RULES);
      fs.writeFileSync(
        path.join(xmlDir, "data_extraction_rules.xml"),
        DATA_EXTRACTION_RULES,
      );
      return config;
    },
  ]);
}

function withAndroidBackupPolicy(config) {
  return withBackupRules(withBackupManifest(config));
}

module.exports = withAndroidBackupPolicy;
