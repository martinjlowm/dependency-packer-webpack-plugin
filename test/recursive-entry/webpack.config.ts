import * as path from 'path';
import { TsconfigPathsPlugin } from 'tsconfig-paths-webpack-plugin';
import nodeExternals from 'webpack-node-externals';
import * as webpack from 'webpack';

import { DependencyPackerPlugin } from '../../src/plugin';

const entries = {
  'simple-1': './src/entries/simple.ts',
  'simple-2': './src/entries/simple.ts',
};

const baseConfig: webpack.Configuration = {
  mode: 'development',
  target: 'node',
  devtool: 'source-map',

  resolve: {
    extensions: ['.ts', '.js', '.json'],
    plugins: [new TsconfigPathsPlugin()],
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
      new DependencyPackerPlugin({ blacklist: ['aws-sdk'] }),
    ],
  };
});
