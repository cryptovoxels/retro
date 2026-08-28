const DEFAULT_BUILD_NUM = '69420'
const TerserPlugin = require('terser-webpack-plugin')
const path = require('path')
const webpack = require('webpack')
const webpackCommon = require('./webpack-common.config')
const { merge } = require('webpack-merge')
const CompressionPlugin = require('compression-webpack-plugin')
const CircularDependencyPlugin = require('circular-dependency-plugin')
const zlib = require('zlib')

const opts = {
  RUNTIME: 'WEB',
}

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production'
  const BUILD_NUMBER = process.env.BUILD_NUM || DEFAULT_BUILD_NUM
  return merge(webpackCommon(env, argv), {
    name: 'web',
    entry: './web/src/main.tsx',
    devServer: {
      port: 9200,
      // preact-router paths like /parcels/:id are client-side; serve index.html for deep links.
      historyApiFallback: true,
      // Local web UI uses /api/* relative URLs; forward to prod so parcel pages work without a local DB.
      proxy: [
        {
          context: ['/api'],
          target: 'https://www.voxels.com',
          changeOrigin: true,
          secure: true,
        },
      ],
    },
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
                // Skip type checking in development but enable it for production
                // so that the build fails if types are wrong
                transpileOnly: argv.mode !== 'production',
                configFile: argv.mode !== 'production' ? 'tsconfig.json' : 'tsconfig.prod.json',
              },
            },
            {
              loader: 'ifdef-loader',
              options: opts,
            },
          ],
          // The merged app bundle compiles both web/ and src/ (the client), but never the server.
          exclude: [path.resolve(__dirname, '../node_modules'), path.resolve(__dirname, '../server')],
        },

        // strip comments out of the shaders (client engine imports these)
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
        fs: false,
        path: false,
        url: false,
      },
      fullySpecified: false,
    },
    output: {
      filename: `${BUILD_NUMBER}-app.js`,
      path: path.resolve(__dirname, '../dist'),
    },
    plugins: [
      // @gltf-transform/core ships NodeIO with node:fs / node:path; strip the scheme so fallbacks apply
      new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
        resource.request = resource.request.replace(/^node:/, '')
      }),
      new webpack.ProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
      }),
      isProduction &&
        new CircularDependencyPlugin({
          exclude: /node_modules/,
          // merging web + client may surface new cycles; warn instead of failing the build
          failOnError: false,
          allowAsyncCycles: true,
          cwd: process.cwd(),
        }),
      isProduction &&
        new CompressionPlugin({
          filename: '[path][base].gz',
          algorithm: 'gzip',
          test: /\.js$|\.css$|\.html$/,
          threshold: 1024, // the same as the express middleware default
          minRatio: 0.8,
        }),
      isProduction &&
        new CompressionPlugin({
          filename: '[path][base].br',
          algorithm: 'brotliCompress',
          test: /\.(js|css|html|svg)$/,
          compressionOptions: {
            params: {
              [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
            },
          },
          threshold: 8192,
          minRatio: 0.8,
        }),
    ].filter((p) => p),
  })
}
