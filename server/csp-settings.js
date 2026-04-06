const csp = require('helmet-csp')

// const twitter_platform = 'platform.twitter.com'
// const twitter = ['cdn.syndication.twimg.com', 'twitter.com', 'syndication.twitter.com', twitter_platform]
// we need to load https://immersive-web.github.io/webxr-input-profiles/packages/viewer/dist/profiles/profilesList.json
// to make webXR work
// const webxr = ['https://immersive-web.github.io']

const crvoxAll = '*.crvox.com'

// no need to specify voxels.com as it will be allowed by 'self'
const voxels = ['cryptovoxels.com', '*.cryptovoxels.com', 'mapping-yhsgv.ondigitalocean.app']

/**
 * Set reportOnly to true to only report violations without blocking them (useful for testing)
 * @param {boolean?} reportOnly
 * @returns
 */
module.exports = (reportOnly) =>
  csp({
    // Specify directives as normal.
    directives: {
      // only allow CV to be embedded in websites served with HTTPS
      // also used to allow untrusted.cryptovoxels.com to server scripts to www
      frameAncestors: ["'self'", 'https:'],
      // Only from self and cdn
      defaultSrc: ["'self'", '*.seadn.io', 'discordapp.com', 'controllers.babylonjs.com', 'www.youtube.com', 'blob:', crvoxAll, ...voxels],

      // Need unsafe-eval for turf
      // Need unsafe-inline for metamask on firefox :(
      // Need blob for workers
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'blob:', 'cdn.babylonjs.com', ...voxels],

      // need unsafe-inline for babylonjs webvr button
      styleSrc: ["'self'", "'unsafe-inline'", ...voxels],
      mediaSrc: ['*', 'blob:'],
      imgSrc: ['data:', 'blob:', '*', '*.seadn.io'],
      objectSrc: ["'self'", ...voxels, 'discordapp.com', crvoxAll],
      connectSrc: [
        '*', // whitelist all urls for grid server
        "'self'",
        'data:',
      ],
      frameSrc: ["'self'", '*'],
      workerSrc: ["'self'", 'blob:', ...voxels],

      // Fonts from google
      fontSrc: ["'self'"],
      // sandbox: ['allow-forms', 'allow-scripts'],
      // reportUri: '/report-violation',
      // objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },

    useDefaults: true,
    // Set to true if you only want browsers to report errors, not block them.
    // You may also set this to a function(req, res) in order to decide dynamically
    // whether to use reportOnly mode, e.g., to allow for a dynamic kill switch.
    reportOnly: reportOnly === true,
  })
