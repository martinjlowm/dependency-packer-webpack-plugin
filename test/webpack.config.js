const path = require('path');
const DependencyPackerPlugin = require('../dist/plugin').DependencyPackerPlugin;
const nodeExternals = require('webpack-node-externals');

module.exports = {
  mode: 'development',
  target: 'node',
  devtool: 'source-map',
  entry: {
    'testEntry': './test-entry.js',
  },
  externals: [nodeExternals()],
  output: {
    libraryTarget: 'commonjs',
    filename: '[name]/[name].js',
    path: path.resolve(__dirname, '.webpack'),
  },
  plugins: [
    new DependencyPackerPlugin({ packageManager: 'yarn' }),
  ]
};
