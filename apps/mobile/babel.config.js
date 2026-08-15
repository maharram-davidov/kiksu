module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // Mirrors the "@/*" -> "./src/*" mapping in tsconfig.json so runtime
      // bundling and type-checking agree on the same alias.
      ['module-resolver', { root: ['./'], alias: { '@': './src' } }],
      // react-native-reanimated's plugin must always be listed last.
      'react-native-reanimated/plugin',
    ],
  };
};
