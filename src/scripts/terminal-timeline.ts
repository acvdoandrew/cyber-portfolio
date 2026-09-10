export interface TypingLine { length: number; start: number; end: number; }

export function typingTimeline(lengths: readonly number[]): TypingLine[] {
  let cursor = 300;
  return lengths.map((value, index) => {
    const length = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    const start = cursor;
    const end = start + length * (index === 0 ? 48 : 23);
    cursor = end + (index === 0 ? 340 : 170);
    return { length, start, end };
  });
}

export function typingFrame(lines: readonly TypingLine[], elapsed: number) {
  const time = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  const counts = lines.map((line) => {
    const progress = Math.min(1, Math.max(0, (time - line.start) / Math.max(1, line.end - line.start)));
    return Math.floor(line.length * progress);
  });
  const active = lines.findIndex((line) => time < line.end);
  const index = active < 0 ? Math.max(0, lines.length - 1) : active;
  return {
    counts,
    line: index,
    progress: lines[index]?.length ? counts[index] / lines[index].length : 1,
    complete: active < 0,
  };
}
