// Conversions between UTC instants and wall-clock time in an IANA time zone.
// Storage uses UTC; scheduling rules run on the user's local dates and times.

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let value = formatters.get(timeZone);
  if (!value) {
    value = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, value);
  }
  return value;
}
export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== "string" || !timeZone || timeZone.length > 64)
    return false;
  try {
    formatter(timeZone);
    return true;
  } catch {
    return false;
  }
}
function wallParts(instant: Date, timeZone: string) {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}
/** Minutes the zone is ahead of UTC at the given instant. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const p = wallParts(instant, timeZone);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return Math.round(
    (asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000,
  );
}
/**
 * The UTC instant for a local date ("YYYY-MM-DD") and time ("HH:mm").
 * Times skipped by a daylight-saving jump resolve to the later offset.
 */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = offsetMinutes(new Date(guess), timeZone);
  const early = guess - first * 60000;
  const second = offsetMinutes(new Date(early), timeZone);
  if (second === first) return new Date(early);
  const late = guess - second * 60000;
  if (offsetMinutes(new Date(late), timeZone) === second) return new Date(late);
  // The local time does not exist (clocks jumped forward): move past the gap.
  return new Date(early);
}
const pad = (value: number) => String(value).padStart(2, "0");
/** Local date and time for a UTC instant. */
export function utcToZoned(
  instant: Date | string,
  timeZone: string,
): { date: string; time: string } {
  const p = wallParts(new Date(instant), timeZone);
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`,
  };
}
/** The current local date and minute of the day in a time zone. */
export function zonedNow(
  timeZone: string,
  now = new Date(),
): { date: string; minutes: number } {
  const p = wallParts(now, timeZone);
  const partial = p.second > 0 || now.getMilliseconds() > 0 ? 1 : 0;
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    minutes: p.hour * 60 + p.minute + partial,
  };
}
/** Local "YYYY-MM-DDTHH:mm" for an instant, the format used by deadlines. */
export function localStamp(instant: Date | string, timeZone: string): string {
  const { date, time } = utcToZoned(instant, timeZone);
  return `${date}T${time}`;
}
