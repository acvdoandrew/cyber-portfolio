/** Pure helpers for the console chrome. No DOM access, so tests can pin them. */

const pad = (value: number, length = 2) => String(Math.max(0, Math.floor(value))).padStart(length, '0');

export const HOME_TIME_ZONE = 'America/New_York';

const clockFormatters = new Map<string, Intl.DateTimeFormat>();

/** Wall-clock time as HH:MM:SS in the given zone, always 24-hour. */
export function formatClock(date: Date, timeZone = HOME_TIME_ZONE) {
  let formatter = clockFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    clockFormatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${pad(Number(parts.hour) % 24)}:${pad(Number(parts.minute))}:${pad(Number(parts.second))}`;
}

/** Elapsed time as HH:MM:SS; hours keep counting past 99 without wrapping. */
export function formatUptime(milliseconds: number) {
  const total = Number.isFinite(milliseconds) ? Math.max(0, Math.floor(milliseconds / 1000)) : 0;
  return `${pad(total / 3600)}:${pad((total % 3600) / 60)}:${pad(total % 60)}`;
}

/** UTC offset of a zone at an instant, e.g. "UTC−04:00". */
export function utcOffsetLabel(date: Date, timeZone = HOME_TIME_ZONE) {
  const zoned = new Date(date.toLocaleString('en-US', { timeZone }));
  const utc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  const minutes = Math.round((zoned.getTime() - utc.getTime()) / 60000);
  const sign = minutes < 0 ? '−' : '+';
  const absolute = Math.abs(minutes);
  return `UTC${sign}${pad(absolute / 60)}:${pad(absolute % 60)}`;
}

/** Deterministic 32-bit hash in [0, 1). */
export function hash01(...values: number[]) {
  let h = 2166136261;
  for (const value of values) {
    h ^= Math.floor(value * 1000003) | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
    h = Math.imul(h, 1540483477);
    h ^= h >>> 15;
  }
  return (h >>> 0) / 4294967296;
}

export function hexWord(seed: number, tick: number, digits = 8) {
  let word = '';
  for (let i = 0; i < digits; i++) {
    word += Math.floor(hash01(seed, tick, i) * 16).toString(16).toUpperCase();
  }
  return word;
}

/** One line of the boot memory dump: address plus two data words. */
export function hexDumpLine(row: number, tick: number) {
  const address = (0x3f00 + row * 16).toString(16).toUpperCase().padStart(4, '0');
  return `${address}  ${hexWord(row, tick)} ${hexWord(row + 50, tick)}`;
}

export interface HexCell {
  x: number;
  y: number;
  /** Distance from the disc center, 0 at the middle and 1 at the rim. */
  distance: number;
  /** Stable per-cell noise used for staggering and highlights. */
  noise: number;
}

/** Pointy-top hex cells whose centers fall inside a disc. */
export function hexDisc(radius: number, cell: number): HexCell[] {
  const columnStep = Math.sqrt(3) * cell;
  const rowStep = 1.5 * cell;
  const rows = Math.ceil(radius / rowStep) + 1;
  const columns = Math.ceil(radius / columnStep) + 1;
  const cells: HexCell[] = [];
  for (let row = -rows; row <= rows; row++) {
    for (let column = -columns; column <= columns; column++) {
      const x = column * columnStep + (Math.abs(row) % 2 ? columnStep / 2 : 0);
      const y = row * rowStep;
      const distance = Math.hypot(x, y);
      if (distance > radius - cell * 0.9) continue;
      cells.push({ x, y, distance: distance / radius, noise: hash01(row + 40, column + 40, 7) });
    }
  }
  return cells;
}

/** SVG path for a pointy-top hexagon. */
export function hexPath(x: number, y: number, radius: number) {
  let path = '';
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 6 + (i * Math.PI) / 3;
    path += `${i ? 'L' : 'M'}${(x + radius * Math.cos(angle)).toFixed(2)} ${(y + radius * Math.sin(angle)).toFixed(2)}`;
  }
  return `${path}Z`;
}
