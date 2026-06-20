const path = require('path')
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin
const TerserPlugin = require('terser-webpack-plugin')
const Dotenv = require('dotenv-webpack')

/** @returns {import('webpack-dev-server').WebpackConfiguration} */
module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production'
  const envPath = isProduction ? '.env.production' : '.env'

  return {
    devtool: isProduction ? false : 'eval-source-map',
    cache: createCacheSettings(isProduction),
    snapshot: {
      managedPaths: [path.resolve(__dirname, '../node_modules')],
      buildDependencies: {
        hash: true,
        timestamp: false,
      },
      module: {
        hash: true,
        timestamp: false,
      },
      resolve: {
        hash: true,
        timestamp: false,
      },
      resolveBuildDependencies: {
        hash: true,
        timestamp: false,
      },
    },
    devServer: {
      allowedHosts: ['cryptovoxels.local', 'voxels.local'],
      client: {
        overlay: false,
      },
    },
    optimization: {
      minimizer: [
        new TerserPlugin({
          terserOptions: {
            compress: {
              defaults: false,
            },
          },
        }),
      ],
    },

    module: {
      rules: [
        {
          test: /\.(vsh|fsh|fx)$/,
          use: 'raw-loader',
        },
        {
          test: /\.md$/,
          use: 'raw-loader',
        },
      ],
    },
    plugins: [
      new Dotenv({
        path: envPath,
        systemvars: true,
      }),
      new BundleAnalyzerPlugin({
        analyzerMode: 'disabled',
        openAnalyzer: false,
      }),
    ],
    resolve: {
      extensions: ['.tsx', '.ts', '.js', '.mjs'],
      alias: {
        '~': path.resolve(__dirname, '..'),
        Server: path.resolve(__dirname, '../server'),
        Web: path.resolve(__dirname, '../web'),
        Src: path.resolve(__dirname, '../src'),
        react: 'preact/compat',
        'react-dom/test-utils': 'preact/test-utils',
        'react-dom': 'preact/compat', // Must be below test-utils
        'react/jsx-runtime': 'preact/jsx-runtime',
      },
      fallback: {
        fs: false,
        crypto: false,
        module: false,
        stream: require.resolve('stream-browserify'),
        http: require.resolve('stream-http'),
        https: require.resolve('https-browserify'),
        os: require.resolve('os-browserify/browser'),
        path: require.resolve('path-browserify'),
      },
    },
  }
}

function createCacheSettings(isProduction) {
  const settings = {
    type: 'filesystem',
    buildDependencies: {
      config: [__filename],
    },
  }

  if (isProduction) settings.cacheDirectory = path.resolve(__dirname, '../.build')

  return settings
}
