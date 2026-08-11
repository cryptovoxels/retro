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
  // Server tests - pure Node.js environment. the older server/test/*-test.ts files are tape, not vitest
  {
    test: {
      name: 'server',
      include: ['server/test/**/*.test.ts'],
      environment: 'node',
      globals: true,
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
])
