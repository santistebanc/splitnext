const path = require('node:path');

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// @splitnext/client re-exports the SDK from the repository's src/client, which
// is outside the workspace folders Expo watches by default. Without this, SDK
// edits need a dev server restart before the app sees them.
config.watchFolders = [
  ...config.watchFolders,
  path.resolve(__dirname, '../../src'),
];

module.exports = config;
