import { defineVitestConfig } from '@nuxt/test-utils/config'

// Tests under tests/nuxt/* run with environment: 'nuxt' (sets up the
// Nuxt context for composables that use useState etc).
// Tests under tests/unit/* run with happy-dom — the browser-shaped DOM
// gives us Blob / File / URL.createObjectURL / FormData with full
// round-trip support, which Node's globals don't fully cover (JSZip
// in particular can't re-read its own browser Blob output in Node).
export default defineVitestConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'happy-dom',
    environmentMatchGlobs: [
      ['tests/nuxt/**', 'nuxt'],
    ],
    // Forks pool gives each test file its own subprocess. Without this
    // the Nuxt test environment leaves a Vite server / event listeners
    // alive after the suite finishes ("Tests closed but something
    // prevents exit"), which leaks a non-zero exit and breaks CI.
    // (Vitest 4 moved per-pool options to the top level.)
    pool: 'forks',
    isolate: true,
  },
})
