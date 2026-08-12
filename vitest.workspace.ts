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
])
