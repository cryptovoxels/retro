// ABOUTME: Vitest configuration for testing the feature pump v2 system
// ABOUTME: Configures modern testing environment with TypeScript support

import { defineConfig } from 'vitest/config'
import path from 'path'

// Custom plugin to handle shader files
const shaderPlugin = () => {
  return {
    name: 'shader-loader',
    transform(code: string, id: string) {
      if (id.endsWith('.vsh') || id.endsWith('.fsh') || id.endsWith('.fx')) {
        // Return the shader code as a string export
        return {
          code: `export default ${JSON.stringify(code)}`,
          map: null,
        }
      }
    },
  }
}

export default defineConfig({
  plugins: [shaderPlugin()],

  // JSX configuration for Preact
  esbuild: {
    jsxFactory: 'h',
    jsxFragment: 'Fragment',
    jsxInject: `import { h, Fragment } from 'preact'`,
  },

  test: {
    // Note: include/exclude patterns are now managed by vitest.workspace.ts
    // This config serves as the base for the 'client' workspace project

    // Default environment and setup for client tests
    environment: 'jsdom',
    setupFiles: ['./test/babylon-setup.ts'],
    globals: true,

    // Timeout configuration
    testTimeout: 10000,
    hookTimeout: 10000,

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'test/', 'vendor/', 'dist/', '.build/', 'packages/', '**/*.config.ts', '**/*.config.js', '**/babylon-setup.ts'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
    },
  },

  // Resolve configuration for TypeScript paths and module resolution
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@test': path.resolve(__dirname, './test'),
      // Fix Preact JSX import issues
      'preact/src/jsx': 'preact/jsx-runtime',
    },
  },

  // Define globals for BABYLON.js and other dependencies
  define: {
    global: 'globalThis',
    window: 'globalThis',
  },

  // SSR configuration to handle CommonJS modules
  ssr: {
    noExternal: ['ndarray', 'ao-mesher'], // Force these CommonJS modules to be processed by Vite
  },
})
