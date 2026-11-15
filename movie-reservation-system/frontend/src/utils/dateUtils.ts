/**
 * Date and time formatting helpers for showtimes and ticket bookings.
 */

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  return `${hours}h ${mins.toString().padStart(2, '0')}m`;
}

export function formatTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return isoString;
  }
}

export function formatDateShort(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  } catch {
    return isoString;
  }
}

export function formatFullDateTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    const date = d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${date} · ${time}`;
  } catch {
    return isoString;
  }
}

export function formatCancellationCutoff(showtimeIso: string, cutoffHours = 2): string {
  try {
    const show = new Date(showtimeIso);
    const cutoff = new Date(show.getTime() - cutoffHours * 60 * 60 * 1000);
    const date = cutoff.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
    const time = cutoff.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${date} at ${time}`;
  } catch {
    return `${cutoffHours} hours before the show`;
  }
}

export function isPastCutoff(showtimeIso: string, cutoffHours = 2): boolean {
  try {
    const show = new Date(showtimeIso);
    const cutoff = new Date(show.getTime() - cutoffHours * 60 * 60 * 1000);
    return Date.now() >= cutoff.getTime();
  } catch {
    return false;
  }
}

export interface DayOption {
  dateString: string; // YYYY-MM-DD
  dayLabel: string; // 'Today', 'Mon', etc.
  dayNumber: string; // '15'
  monthLabel: string; // 'Nov'
  isToday: boolean;
}

export function getUpcomingDays(count = 7, startDate = new Date()): DayOption[] {
  const days: DayOption[] = [];
  const base = new Date(startDate);
  base.setHours(0, 0, 0, 0);

  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const dateString = `${year}-${month}-${day}`;

    const isToday = i === 0;
    const dayLabel = isToday
      ? 'Today'
      : d.toLocaleDateString([], { weekday: 'short' });
    const dayNumber = String(d.getDate());
    const monthLabel = d.toLocaleDateString([], { month: 'short' });

    days.push({
      dateString,
      dayLabel,
      dayNumber,
      monthLabel,
      isToday,
    });
  }

  return days;
}

export function formatLocalDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getDaysBetween(startStr: string, endStr: string): string[] {
  const days: string[] = [];
  const [sy, sm, sd] = startStr.split('-').map(Number);
  const [ey, em, ed] = endStr.split('-').map(Number);
  const current = new Date(sy, sm - 1, sd, 12, 0, 0);
  const end = new Date(ey, em - 1, ed, 12, 0, 0);

  while (current <= end) {
    days.push(formatLocalDate(current));
    current.setDate(current.getDate() + 1);
  }
  return days;
}

/** True when the runtime knows this IANA time zone. */
export function isValidTimeZone(timeZone: string | null | undefined): timeZone is string {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Offset of `timeZone` from UTC at `instantMs`, in milliseconds (east of UTC is positive). */
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instantMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wallAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return wallAsUtc - Math.floor(instantMs / 1000) * 1000;
}

/**
 * The instant at which the wall clock in `timeZone` shows `date` (YYYY-MM-DD) `time` (HH:mm).
 * Without a valid zone the browser's own zone is used.
 */
export function zonedWallTimeToDate(date: string, time: string, timeZone?: string | null): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  if (!isValidTimeZone(timeZone)) {
    return new Date(y, m - 1, d, hh, mm, 0);
  }
  const wallAsUtc = Date.UTC(y, m - 1, d, hh, mm, 0);
  let guess = wallAsUtc;
  for (let i = 0; i < 3; i++) {
    const next = wallAsUtc - zoneOffsetMs(guess, timeZone);
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

/** Today's date (YYYY-MM-DD) on the wall clock of `timeZone` (browser zone if invalid). */
export function todayInZone(timeZone?: string | null, now: Date = new Date()): string {
  if (!isValidTimeZone(timeZone)) return formatLocalDate(now);
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
