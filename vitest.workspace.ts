// ABOUTME: Vitest workspace configuration for multi-environment testing.
// ABOUTME: Separates client tests (jsdom + Babylon) from compressor tests (Node.js).

import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  // Client tests - jsdom environment with Babylon.js setup
  {
    extends: './vitest.config.ts',
    test: {
      name: 'client',
      include: ['test/**/*.test.ts'],
      exclude: ['test/compressor/**'],
    },
  },
  // Compressor tests - pure Node.js environment
  {
    test: {
      name: 'compressor',
      include: ['test/compressor/**/*.test.ts'],
      environment: 'node',
      globals: true,
    },
  },
  // Server tape tests. same runner as the rest, tape API not vitest expect()
  {
    test: {
      name: 'server',
      include: ['server/test/**/*-test.ts'],
      // these hit postgres with a schema that does not match, or load the db on import
      exclude: ['server/test/favorites-test.ts', 'server/test/report-test.ts', 'server/test/suspended-avatars-test.ts', 'server/test/parcel-test.ts'],
      environment: 'node',
      globals: false,
      setupFiles: ['./test/vitest-tape.ts'],
      isolate: true,
    },
  },
])
