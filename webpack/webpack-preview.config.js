// ABOUTME: Webpack entry for the Playwright parcel preview page (shaders + full Parcel engine).

const path = require('path')
const webpack = require('webpack')
const webpackCommon = require('./webpack-common.config')
const { merge } = require('webpack-merge')

const opts = {
  RUNTIME: 'WEB',
}

module.exports = (env, argv) => {
  const mode = (argv && argv.mode) || 'production'
  return merge(webpackCommon(env, { ...argv, mode }), {
    name: 'parcel-preview',
    mode,
    entry: './src/preview/parcel-preview.ts',
    externals: {
      babylonjs: 'babylonjs',
    },
    node: {
      global: true,
    },
    module: {
      rules: [
        {
          test: /\.([cm]?ts|tsx)$/,
          use: [
            {
              loader: 'ts-loader',
              options: {
                // Preview bundle: transpile only. Don't typecheck the whole client in Docker.
                transpileOnly: true,
                configFile: 'tsconfig.json',
              },
            },
            {
              loader: 'ifdef-loader',
              options: opts,
            },
          ],
          exclude: [path.resolve(__dirname, '../node_modules'), path.resolve(__dirname, '../server'), path.resolve(__dirname, '../renderer')],
        },
        {
          test: /\.(vsh|fsh|fx)$/,
          use: {
            loader: 'strip-json-comments-loader',
          },
        },
      ],
    },
    resolve: {
      fallback: {
        crypto: false,
        vm: false,
        buffer: require.resolve('buffer/'),
      },
      fullySpecified: false,
    },
    output: {
      filename: 'parcel-bundle.js',
      path: path.resolve(__dirname, '../renderer/page'),
      // Workers (mono-pool) resolve relative to the page URL.
      publicPath: 'auto',
    },
    plugins: [
      new webpack.ProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
      }),
    ],
    // Keep the Docker build from OOMing on a giant client graph.
    optimization: {
      minimize: false,
    },
    performance: {
      hints: false,
    },
  })
}
