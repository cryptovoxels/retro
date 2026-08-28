// ABOUTME: Run the same production build DigitalOcean runs. Fail precommit if it breaks.

import { execSync } from 'node:child_process'

const env = { ...process.env, NODE_ENV: 'production' }

console.log('[build:check] running production build (same as DigitalOcean deploy)...')
execSync('npm run build', { stdio: 'inherit', env })

console.log('[build:check] ok')
