import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  // STOREFRONT_GATEWAY_URL may come from the shell or a .env.local file; it is only used by the
  // dev/preview proxy and never reaches the browser bundle (no VITE_ prefix).
  const env = loadEnv(mode, '.', 'STOREFRONT_');
  /** The API gateway; every backend call goes through it, so the browser stays same-origin. */
  const gateway = env.STOREFRONT_GATEWAY_URL || 'http://localhost:8080';
  const proxy = {
    '/api': {
      target: gateway,
      changeOrigin: false,
    },
  };

  return {
    plugins: [react()],
    server: {
      port: 5179,
      strictPort: true,
      proxy,
    },
    preview: {
      port: 5179,
      strictPort: true,
      proxy,
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      restoreMocks: true,
      unstubGlobals: true,
      css: false,
    },
  };
});
