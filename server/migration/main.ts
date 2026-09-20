// ABOUTME: CLI entry for the migrate bundle, run on its own before the server boots.
// ABOUTME: Separate from migrate.ts because require.main is the whole bundle, not this module.

import { runMigrations } from './migrate'

runMigrations()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => process.exit())
