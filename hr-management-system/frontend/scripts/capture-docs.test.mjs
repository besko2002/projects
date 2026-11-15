// Runs the real capture script against a browser double to inspect its intercepted fixtures.
// Actual screenshot rendering is verified separately with Chromium.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

for (const today of ['2032-01-01', '2032-02-15', '2032-11-15', '2032-12-31']) {
  test(`capture fixtures agree with the calendar and session totals on ${today}`, async () => {
    const responses = [];
    const locator = { waitFor: async () => {}, click: async () => {}, fill: async () => {}, count: async () => 0 };
    globalThis.__captureTestBrowser = {
      newContext: async () => ({
        addInitScript: async () => {},
        route: async (_predicate, handler) => {
          for (const path of ['/api/attendance/employees/emp-2', '/api/attendance/today']) {
            await handler({ request: () => ({ url: () => `http://fixtures.test${path}`, method: () => 'GET' }),
              fulfill: async (response) => responses.push({ path, body: response.json }) });
          }
        },
        newPage: async () => ({ on: () => {}, goto: async () => {}, getByRole: () => locator,
          getByLabel: () => locator, screenshot: async () => {} }),
        close: async () => {},
      }),
      close: async () => {},
    };
    const url = new URL('./capture-docs.mjs', import.meta.url);
    let source = await readFile(url, 'utf8');
    source = source.replace("import { chromium } from '@playwright/test';",
      'const chromium = { launch: async () => globalThis.__captureTestBrowser };')
      .replace("from 'esbuild'", `from ${JSON.stringify(import.meta.resolve('esbuild'))}`)
      .replaceAll('import.meta.url', JSON.stringify(url.href));
    source = `const Date = class extends globalThis.Date { constructor(...args) { super(...(args.length ? args : ['${today}T12:00:00Z'])); } };\n` + source;
    try {
      await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
      assert.equal(responses.length, 18);
      const range = responses.find(({ path }) => path.endsWith('/emp-2')).body;
      assert.equal(range.from, `${today.slice(0, 7)}-01`);
      const last = new globalThis.Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10);
      assert.equal(range.to, last);
      const day = range.days[0];
      assert.ok(day.day >= range.from && day.day <= today);
      assert.equal(day.sessions[0].workDate, day.day);
      assert.equal(day.sessionCount, day.sessions.length);
      assert.equal(day.workedMinutes, day.sessions.reduce((sum, session) => sum + session.minutes, 0));
      assert.equal(day.overtimeMinutes, 0);
      assert.equal(range.workedMinutes, day.workedMinutes);
      assert.equal(range.overtimeMinutes, day.overtimeMinutes);
      assert.equal(range.lateMinutes, day.lateMinutes);
      assert.equal(range.presentDays, 1);
    } finally {
      delete globalThis.__captureTestBrowser;
    }
  });
}
