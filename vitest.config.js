import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    globalSetup: ['tests/globalSetup.js'],
    setupFiles: ['tests/setup.js'],
    // The first run downloads the MongoDB binary used by mongodb-memory-server.
    hookTimeout: 600_000,
    env: {
      NODE_ENV: 'test',
      JWT_SECRET: 'test-secret-that-is-long-enough-for-hs256-signing',
      CLIENT_ORIGIN: 'http://localhost:5173',
      HISTORY_MAX_ENTRIES: '5',
      SECRETS_ENCRYPTION_KEY: 'dGVzdC1rZXktdGhhdC1pcy1leGFjdGx5LTMyLWJ5dGU=',
    },
  },
});
