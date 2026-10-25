const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The offline chat domain (message merge, outbox policy, sync controller) is
// shared with the web app, which lives in the same monorepo. Expo is not a
// workspace member, so Metro has to be told to watch and resolve the package
// outside this project root.
config.watchFolders = [
  ...(config.watchFolders ?? []),
  path.resolve(__dirname, '..', 'packages', 'offline-chat'),
];

module.exports = config;
