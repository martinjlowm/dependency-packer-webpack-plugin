import * as path from 'path';
import { TsconfigPathsPlugin } from 'tsconfig-paths-webpack-plugin';
import nodeExternals from 'webpack-node-externals';
import { DependencyPackerPlugin } from 'dependency-packer-webpack-plugin';
import * as webpack from 'webpack';

const config: webpack.Configuration = {
  mode: 'development',
  target: 'node',
  devtool: 'source-map',

  entry: {
    main: './src/entries/main.ts',
  },

  resolve: {
    extensions: ['.ts'],
    plugins: [
      new TsconfigPathsPlugin(),
    ],
  },

  externals: [nodeExternals()],

  output: {
    libraryTarget: 'commonjs',
    filename: '[name].js',
    path: path.resolve(__dirname, '.webpack', 'main'),
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
    new DependencyPackerPlugin({
      blacklist: ['aws-sdk'],
    }),
  ],
};

export default config;
