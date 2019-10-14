import * as path from 'path';
import { TsconfigPathsPlugin } from 'tsconfig-paths-webpack-plugin';
import nodeExternals = require('webpack-node-externals');

import { DependencyPackerPlugin } from '../src/plugin';

const entries = {
  'simple-1': './entries/simple.ts',
  'simple-2': './entries/simple.ts',
};

const baseConfig = {
  mode: 'development',
  target: 'node',
  devtool: 'source-map',

  resolve: {
    extensions: ['.ts', '.js', '.json'],
    plugins: [new TsconfigPathsPlugin({ configFile: `${__dirname}/../tsconfig.json` })],
  },

  externals: [nodeExternals()],

  output: {
    libraryTarget: 'commonjs',
    filename: '[name].js',
  },

  module: {
    rules: [
      {
        test: /\.tsx?$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'babel-loader',
            options: {
              presets: [
                '@babel/preset-typescript',
              ],
            },
          },
        ],
      },
    ],
  },

  plugins: [],
};

export default Object.keys(entries).map(entry => {
  return {
    ...baseConfig,
    entry: {
      [entry]: entries[entry],
    },
    output: {
      ...baseConfig.output,
      path: path.resolve(__dirname, '.webpack', entry),
    },
    plugins: [
      ...baseConfig.plugins,
      new DependencyPackerPlugin({ packageManager: 'yarn', blacklist: ['aws-sdk'] }),
    ],
  };
});
