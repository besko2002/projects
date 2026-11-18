/**
 * The palette-parity test reads src/index.css from disk because Vitest stubs every CSS import —
 * including `?raw` — to an empty module. The application itself never uses Node APIs, so this
 * declares only the one function that test needs instead of pulling in all of @types/node.
 */
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}
