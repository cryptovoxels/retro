// load .env file
const path = require('path')
const { currentVersion } = require('../common/version')

const nodeEnv = process.env.NODE_ENV || 'development'

let envPath = '.env'

if (nodeEnv === 'production') {
  envPath = '.env.production'
} else if (nodeEnv === 'test') {
  envPath = '.env.test'
}

if (process.env.CODESPACES === 'true') {
  envPath = '.env.example'
}

console.log(`NODE_ENV is '${nodeEnv}' and '${envPath}' will be used for dotenv`)

const result = require('dotenv').config({
  path: envPath,
})

if (result.error) {
  if (process.env.NODE_ENV === 'development') {
    // delay the helper message until after logging out error
    setTimeout(() => {
      console.log('\n************************')
      console.log('  CANNOT LOAD LOCAL ENV SETTINGS')
      console.log('  If this is your first time running the code, be sure to')
      console.log('  duplicate `.env.example` to `.env` and update connection string')
      console.log('************************\n')
    })
  }
  throw result.error
}

// @ts-ignore
global.Bugsnag = require('@bugsnag/js')

if (process.env.BUGSNAG_API_KEY) {
  // @ts-ignore
  global.Bugsnag.start({
    apiKey: process.env.BUGSNAG_API_KEY,
    appVersion: currentVersion,
  })
}

require('./server')
