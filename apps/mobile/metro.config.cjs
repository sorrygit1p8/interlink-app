const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
if (process.env.EXPO_PUBLIC_APP_ENV === 'production') {
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName === '@interlink/data') return { type: 'sourceFile', filePath: require.resolve('../../packages/data/src/production.ts') };
    return context.resolveRequest(context, moduleName, platform);
  };
}
module.exports = config;
