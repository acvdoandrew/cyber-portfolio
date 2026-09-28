/** Seven-segment readouts, shared by server-rendered markup and live updates. */
type Point = readonly [number, number];

export const SEGMENTS: Readonly<Record<string, string>> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abdeg',
  '3': 'abcdg',
  '4': 'bcfg',
  '5': 'acdfg',
  '6': 'acdefg',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
  '-': 'g',
  ' ': '',
  A: 'abcefg',
  C: 'adef',
  E: 'adefg',
  F: 'aefg',
  H: 'bcefg',
  L: 'def',
  O: 'abcdef',
  P: 'abefg',
  S: 'acdfg',
  U: 'bcdef',
};

const SEGMENT_NAMES = ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const;
const isPunctuation = (char: string) => char === ':' || char === '.';

export interface SevenSegOptions {
  height?: number;
  /** Stroke thickness as a share of height. */
  thickness?: number;
  /** Horizontal lean per unit of height. */
  skew?: number;
}

interface Geometry {
  height: number;
  width: number;
  thick: number;
  gap: number;
  skew: number;
}

const geometry = ({ height = 40, thickness = 0.11, skew = 0.1 }: SevenSegOptions = {}): Geometry => {
  const thick = height * thickness;
  return { height, width: height * 0.52, thick, gap: thick * 0.18, skew };
};

const advance = (char: string, g: Geometry) =>
  isPunctuation(char) ? g.thick * 2.6 : g.width + g.thick * 1.2;

export function sevenSegWidth(text: string, options: SevenSegOptions = {}) {
  const g = geometry(options);
  let width = 0;
  for (const char of text) width += advance(char, g);
  return width - g.thick * 1.2 + g.height * g.skew;
}

function segmentPoints(name: string, x: number, g: Geometry): Point[] {
  const { width: w, height: h, thick: t, gap: f } = g;
  const s = t / 2;
  const horizontal = (y: number): Point[] => [
    [f + s, y], [f + t, y - s], [w - f - t, y - s],
    [w - f - s, y], [w - f - t, y + s], [f + t, y + s],
  ];
  const vertical = (cx: number, y0: number, y1: number): Point[] => [
    [cx, y0 + f + s], [cx + s, y0 + f + t], [cx + s, y1 - f - t],
    [cx, y1 - f - s], [cx - s, y1 - f - t], [cx - s, y0 + f + t],
  ];
  const middle = h / 2;
  const shape: Record<string, Point[]> = {
    a: horizontal(s),
    b: vertical(w - s, 0, middle),
    c: vertical(w - s, middle, h),
    d: horizontal(h - s),
    e: vertical(s, middle, h),
    f: vertical(s, 0, middle),
    g: horizontal(middle),
  };
  return shape[name].map(([px, py]) => [x + px + (h - py) * g.skew, py] as Point);
}

const pointList = (points: Point[]) =>
  points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');

/** Returns inline SVG markup. Every digit keeps all seven segments so updates only toggle state. */
export function sevenSegMarkup(text: string, options: SevenSegOptions = {}) {
  const g = geometry(options);
  const width = sevenSegWidth(text, options);
  let x = 0;
  let body = '';
  for (const raw of text) {
    const char = raw.toUpperCase();
    if (isPunctuation(char)) {
      const size = g.thick;
      const dots = char === ':'
        ? [[x + size * 0.6 + g.height * 0.66 * g.skew, g.height * 0.3], [x + size * 0.6 + g.height * 0.3 * g.skew, g.height * 0.66]]
        : [[x + size * 0.4, g.height - size]];
      body += `<g data-p>${dots.map(([dx, dy]) =>
        `<rect x="${dx.toFixed(2)}" y="${dy.toFixed(2)}" width="${size.toFixed(2)}" height="${size.toFixed(2)}" data-on/>`).join('')}</g>`;
    } else {
      const lit = SEGMENTS[char] ?? '';
      body += `<g data-d>${SEGMENT_NAMES.map((name) =>
        `<polygon data-s="${name}" points="${pointList(segmentPoints(name, x, g))}"${lit.includes(name) ? ' data-on' : ''}/>`).join('')}</g>`;
    }
    x += advance(char, g);
  }
  return `<svg class="seg" viewBox="0 0 ${width.toFixed(2)} ${g.height}" width="${width.toFixed(2)}" height="${g.height}" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** Updates a rendered readout in place. Text must keep the original digit/punctuation layout. */
export function setSevenSeg(svg: SVGSVGElement, text: string) {
  const groups = svg.querySelectorAll<SVGGElement>('g[data-d], g[data-p]');
  let index = 0;
  for (const raw of text) {
    const group = groups[index++];
    if (!group) return;
    if (!group.hasAttribute('data-d')) continue;
    const lit = SEGMENTS[raw.toUpperCase()] ?? '';
    for (const segment of group.children) {
      const on = lit.includes(segment.getAttribute('data-s') ?? '');
      if (segment.hasAttribute('data-on') !== on) segment.toggleAttribute('data-on', on);
    }
  }
}
