const BUNDLE_VERSION = '6.11.2'
const BABYLON_VERSION = '6.11.2'

function babylonBundleUrls(minified) {
  const m = minified ? '.min' : ''
  return {
    BABYLON_LIB_URL: `https://cdn.jsdelivr.net/npm/babylonjs@${BABYLON_VERSION}/babylon.${minified ? 'min' : 'max'}.js`,
    BABYLON_GUI_URL: `https://cdn.jsdelivr.net/npm/babylonjs-gui@${BABYLON_VERSION}/babylon.gui${m}.js`,
    EARCUT_URL: `https://cdn.babylonjs.com/earcut.min.js`,  // There's no earcut.max.js or earcut.js
    BABYLON_MATERIALS_URL: `https://cdn.jsdelivr.net/npm/babylonjs-materials@${BABYLON_VERSION}/babylonjs.materials${m}.js`,
    BABYLON_LOADERS_URL: `https://cdn.jsdelivr.net/npm/babylonjs-loaders@${BABYLON_VERSION}/babylonjs.loaders${m}.js`,
  }
}

const babylonBundleLocalFilenames = [
  'msgpack.js',
  'leaflet.js',
]

// Bundle file names and contents depend on whether we want to minify
function bundles(minified) {
  return {
    BABYLON_BUNDLE: {
      targetFilename: `library-${BUNDLE_VERSION}.${minified ? 'min' : 'max'}.js`,
      sourceUrls: babylonBundleUrls(minified),
      sourceFilenames: babylonBundleLocalFilenames,
    },
  }
}

/**
 * Get URLs of bundled dependencies.
 * @param minified Whether contents should be minified wherever possible
 * @returns object containing BABYLON_BUNDLE_URL keys
 */
function bundleUrls(minified) {
  return Object.fromEntries(Object.entries(bundles(minified)).map(([b, info]) => [`${b}_URL`, `/vendor/${info.targetFilename}`]))
}

module.exports = {
  // For use by the website
  ...bundleUrls(process.env.NODE_ENV !== 'development'),
  UNBUNDLED_BABYLON_LIB_URL_FOR_WEB_WORKERS: babylonBundleUrls(process.env.NODE_ENV !== 'development').BABYLON_LIB_URL, // The bundle references 'window' :(

  // For use by the bundler
  bundles
}
