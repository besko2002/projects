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
