import * as path from 'path';
import { TsconfigPathsPlugin } from 'tsconfig-paths-webpack-plugin';
import nodeExternals = require('webpack-node-externals');

import { DependencyPackerPlugin } from '../dist/plugin';

export default {
  mode: 'development',
  target: 'node',
  devtool: 'source-map',

  entry: {
    'simple': './entries/simple.ts',
  },

  resolve: {
    extensions: ['.ts', '.js', '.json'],
    plugins: [new TsconfigPathsPlugin({ configFile: `${__dirname}/../tsconfig.json` })],
  },

  externals: [nodeExternals()],

  output: {
    libraryTarget: 'commonjs',
    filename: '[name]/[name].js',
    path: path.resolve(__dirname, '.webpack'),
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

  plugins: [
    new DependencyPackerPlugin({ packageManager: 'yarn', blacklist: ['aws-sdk'] }),
  ]
};
