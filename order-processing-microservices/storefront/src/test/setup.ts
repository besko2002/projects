import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * Node 26 exposes an experimental `localStorage` global that is disabled unless the process was
 * started with `--localstorage-file`; in the jsdom environment it shadows the working storage and
 * every write throws. The app guards storage failures on purpose, so without this the cart and
 * checkout attempt would silently not persist in tests. A small in-memory Storage keeps the tests
 * deterministic and independent of the Node flag.
 */
function ensureUsableLocalStorage(): void {
  try {
    const probe = window.localStorage;
    probe.setItem('__storage_probe__', '1');
    probe.removeItem('__storage_probe__');
    return;
  } catch {
    // Fall through to the polyfill.
  }

  const backing = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return backing.size;
    },
    clear() {
      backing.clear();
    },
    getItem(key: string) {
      return backing.has(key) ? (backing.get(key) as string) : null;
    },
    key(index: number) {
      return [...backing.keys()][index] ?? null;
    },
    removeItem(key: string) {
      backing.delete(key);
    },
    setItem(key: string, value: string) {
      backing.set(key, String(value));
    },
  };
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
}

ensureUsableLocalStorage();

// Vitest runs without globals here, so Testing Library cannot register its own cleanup.
// Every test also starts with empty storage: the cart and checkout attempt are persisted there.
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
