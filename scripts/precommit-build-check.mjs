// ABOUTME: Run the same production build DigitalOcean runs. Fail precommit if it breaks.
// ABOUTME: Restore any tracked dist/server files the build touched so output is never committed.

import { execSync } from 'node:child_process'

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] }).trim()
}

const env = { ...process.env, NODE_ENV: 'production' }

console.log('[build:check] running production build (same as DigitalOcean deploy)...')
execSync('npm run build', { stdio: 'inherit', env })

const changed = sh('git diff --name-only -- dist server/bundle_server.js')
if (changed) {
  const files = changed.split('\n').filter(Boolean)
  console.log('[build:check] restoring tracked build output (not for commit):')
  for (const f of files) console.log(`  ${f}`)
  execSync(`git checkout -- ${files.map((f) => JSON.stringify(f)).join(' ')}`, { stdio: 'inherit' })
}

console.log('[build:check] ok')
