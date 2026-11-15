// Capture the actual current UI with fictional, intercepted API fixtures only.
// Start the frontend first, then run: node scripts/capture-docs.mjs
// Requires the existing @playwright/test and esbuild development dependencies.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { transform } from 'esbuild';

const frontend = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(frontend, '../docs/screenshots');
const baseURL = process.env.SCREENSHOT_BASE_URL ?? 'http://127.0.0.1:5175';
const fixturesSource = (await readFile(resolve(frontend, 'src/test/fixtures.ts'), 'utf8'))
  .replace("import { writeToken } from '../api/token';", 'const writeToken = () => {};');
const { code } = await transform(fixturesSource, { loader: 'ts', format: 'esm' });
const f = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const today = new Date().toISOString().slice(0, 10);
const year = Number(today.slice(0, 4));
const month = today.slice(0, 7);
const monthEnd = new Date(Date.UTC(year, Number(today.slice(5, 7)), 0)).toISOString().slice(0, 10);
const sessionDay = `${month}-${String(Math.min(10, Number(today.slice(8, 10)))).padStart(2, '0')}`;
const employee = f.makeEmployee({ fullName: 'Nadia Hassan', email: 'nadia@example.test' });
const hr = f.makeEmployee({ id: 'emp-hr', employeeNumber: 'EMP-0004', fullName: 'Mona Hassan',
  email: 'mona@example.test', role: 'HR', jobTitle: 'People Partner', departmentId: 'dep-2', departmentName: 'People' });
const balances = [
  f.makeBalance({ year, carriedOverDays: 0, usedDays: 3, pendingDays: 0, remainingDays: 18 }),
  f.makeBalance({ year, leaveType: 'SICK', entitledDays: 10, carriedOverDays: 0, usedDays: 0, pendingDays: 0, remainingDays: 10 }),
  f.makeBalance({ year, leaveType: 'UNPAID', paid: false, requiresBalance: false, entitledDays: 0, carriedOverDays: 0, usedDays: 0, pendingDays: 0, remainingDays: 0 }),
];
const approved = f.makeLeaveRequest({ year, startDate: `${year}-09-07`, endDate: `${year}-09-09`,
  status: 'APPROVED', decidedByName: 'Omar Said', decisionNote: 'Approved', reason: 'Personal leave' });
const pending = f.makeLeaveRequest({ id: 'leave-pending', employeeId: 'emp-2', employeeName: 'Youssef Adel',
  year, startDate: `${year}-12-07`, endDate: `${year}-12-09`, reason: 'Annual leave' });
const departments = ['Engineering', 'Finance', 'People', 'Operations'].map((name, i) => ({
  id: `dep-${i}`, name, createdAt: `${year}-01-01T00:00:00Z`,
}));
const staff = [employee, hr,
  f.makeEmployee({ id: 'emp-2', employeeNumber: 'EMP-0002', fullName: 'Youssef Adel', email: 'youssef@example.test',
    jobTitle: 'Software Engineer', departmentName: 'Engineering', salary: 23000 }),
  f.makeEmployee({ id: 'emp-3', employeeNumber: 'EMP-0003', fullName: 'Laila Mahmoud', email: 'laila@example.test',
    jobTitle: 'Operations Specialist', departmentName: 'Operations', salary: 16000 }),
];
const browser = await chromium.launch();
async function capture(path, filename, role = null, revealLogin = false) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors = [];
  const me = role === 'HR' ? hr : employee;
  if (role) await context.addInitScript(() => localStorage.setItem('hr.accessToken', 'fictional-screenshot-token'));
  await context.route(url => url.pathname.startsWith('/api/'), async route => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const table = {
      '/api/employees/me': me,
      '/api/employees/me/team': role === 'MANAGER' ? [f.makeTeamMember()] : [],
      '/api/employees': f.makePage(staff),
      '/api/departments': departments,
      '/api/leave/balances/me': balances,
      '/api/leave/requests/me': f.makePage([approved]),
      '/api/leave/requests/pending': f.makePage([pending]),
      '/api/attendance/me': f.makeAttendanceRange({ from: today, to: today, days: [f.makeDay({
        day: today, firstIn: `${today}T09:00:00`, lastOut: `${today}T17:05:00`, workedMinutes: 485,
      })] }),
      '/api/reports/headcount': [
        f.makeHeadcount({ department: 'Engineering', count: 24 }),
        f.makeHeadcount({ department: 'Finance', count: 6 }),
        f.makeHeadcount({ department: 'People', count: 8 }),
        f.makeHeadcount({ department: 'Operations', count: 15 }),
      ],
      '/api/attendance/today': f.makeAttendanceRange({ from: today, to: today, days: [f.makeDay({ day: today })] }),
      '/api/employees/emp-2': staff[2],
      '/api/employees/emp-2/audit': f.makePage([]),
      '/api/attendance/employees/emp-2': f.makeAttendanceRange({
        employeeId: 'emp-2',
        employeeName: staff[2].fullName,
        from: `${month}-01`,
        to: monthEnd,
        workingDays: 1,
        presentDays: 1,
        lateDays: 0,
        absentDays: 0,
        workedMinutes: 480,
        lateMinutes: 0,
        overtimeMinutes: 0,
        days: [
          f.makeDay({
            day: sessionDay,
            status: 'PRESENT',
            firstIn: `${sessionDay}T09:00:00`,
            lastOut: `${sessionDay}T17:00:00`,
            workedMinutes: 480,
            overtimeMinutes: 0,
            sessions: [
              {
                id: 'sess-1',
                employeeId: 'emp-2',
                workDate: sessionDay,
                checkIn: `${sessionDay}T07:00:00.000Z`,
                checkOut: `${sessionDay}T15:00:00.000Z`,
                localCheckIn: '09:00',
                localCheckOut: '17:00',
                minutes: 480,
                source: 'SELF',
                correctedById: null,
                correctionReason: null,
              },
            ],
          }),
        ],
      }),
    };
    if (request.method() !== 'GET' || !(pathname in table)) {
      errors.push(`${request.method()} ${pathname}`);
      await route.fulfill({ status: 404, json: { message: 'Not available in documentation capture' } });
      return;
    }
    await route.fulfill({ status: 200, json: table[pathname] });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(baseURL + path, { waitUntil: 'networkidle' });
    if (revealLogin) {
      await page.getByRole('button', { name: 'Enter workspace' }).click();
      await page.getByLabel(/work email/i).fill('person@example.test');
    }
    await page.getByRole(role ? 'navigation' : 'button', role
      ? { name: 'Main navigation' } : { name: revealLogin ? 'Sign in' : 'Enter workspace', exact: true }).waitFor();
    assert.deepEqual(errors, [], `Capture errors for ${path}`);
    assert.equal(await page.getByRole('alert').count(), 0, `Unexpected alert on ${path}`);
    await page.screenshot({ path: resolve(output, filename), fullPage: true });
    console.log(`Captured ${filename} — fictional API fixtures; no saved database data accessed`);
  } finally {
    await context.close();
  }
}
try {
  await capture('/login', 'login.png');
  await capture('/login', 'login-open.png', null, true);
  await capture('/', 'employee-dashboard.png', 'EMPLOYEE');
  await capture('/leave', 'employee-leave.png', 'EMPLOYEE');
  await capture('/approvals', 'manager-approvals.png', 'MANAGER');
  await capture('/employees', 'hr-employees.png', 'HR');
  await capture('/employees/emp-2/attendance', 'hr-attendance-repair.png', 'HR');
  await capture('/employees/emp-2', 'hr-password-reset.png', 'HR');
  await capture('/reports', 'hr-reports.png', 'HR');
} finally {
  await browser.close();
}
