module.exports = ({ config }) => {
  const mode = process.env.EXPO_PUBLIC_APP_ENV;
  if (!['development', 'staging', 'production'].includes(mode)) throw new Error('Select a mobile data environment');
  if (mode === 'production') return config;
  return {
    ...config,
    name: `${config.name} ${mode}`,
    scheme: `uxcommunity-${mode}`,
    ios: { ...config.ios, bundleIdentifier: `${config.ios.bundleIdentifier}.${mode}` },
    android: { ...config.android, package: `${config.android.package}.${mode}`, googleServicesFile: undefined },
  };
};
