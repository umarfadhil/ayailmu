// SDK58: expo-asset reads the root ReactNative.AssetRegistry, which is backed by
// a private native registry the jest-expo preset does not mock. Bridge only that
// module to the preset-mocked react-native/asset-registry. doMock factories
// persist across restoreAllMocks/resetModules/isolateModules.
const path = require('node:path');
const nativeRegistry = path.join(path.dirname(require.resolve('react-native/package.json')), 'src/private/assets/AssetRegistry.js');
jest.doMock(nativeRegistry, () => ({ AssetRegistry: require('react-native/asset-registry') }));
