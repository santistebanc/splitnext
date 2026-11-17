const { expo } = require('./app.json');

const { colors } = require('./src/design/tokens.ts');

const localHttpApi = process.env.EXPO_PUBLIC_API_URL?.startsWith('http://') ?? false;

const ios = { ...expo.ios };

if (localHttpApi) {
  ios.infoPlist = {
    NSAppTransportSecurity: { NSAllowsArbitraryLoads: true },
    NSLocalNetworkUsageDescription: 'Connect to a Splitnext server on your local network.',
  };
}

module.exports = {
  expo: {
    ...expo,
    backgroundColor: colors.background,
    primaryColor: colors.ink,
    plugins: [
      ...expo.plugins.map((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties'
        ? [plugin[0], { ...plugin[1], android: { ...plugin[1].android, usesCleartextTraffic: localHttpApi } }]
        : plugin),
      // The launch screen uses the app's paper colour, not the default white.
      ['expo-splash-screen', { backgroundColor: colors.background }],
    ],
    ios,
  },
};
