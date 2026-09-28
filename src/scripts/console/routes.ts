/** Pure routing for the deck: a hash names a channel, or a project inside Work. */

export interface Route {
  channel: string;
  /** The selected project, when the route points inside Work. */
  unit: string | null;
}

/** Old section anchors still land somewhere sensible. */
const ALIASES: Readonly<Record<string, string>> = {
  capabilities: 'tools',
  top: 'home',
};

const decode = (hash: string) => {
  const raw = hash.replace(/^#/, '');
  try {
    return decodeURIComponent(raw).trim().toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
};

export function resolveHash(
  hash: string,
  channels: readonly string[],
  units: readonly string[],
  workChannel = 'work',
): Route {
  const home = channels[0] ?? 'home';
  const key = decode(typeof hash === 'string' ? hash : '');
  const name = ALIASES[key] ?? key;
  if (channels.includes(name)) return { channel: name, unit: null };
  const unit = name.startsWith('project-') ? name.slice('project-'.length) : name;
  if (units.includes(unit)) return { channel: workChannel, unit };
  return { channel: home, unit: null };
}

export function hashFor(route: Route) {
  return `#${route.unit ?? route.channel}`;
}

/** Move through a list with wraparound; unknown values start from the first entry. */
export function step<T>(list: readonly T[], current: T, delta: number): T {
  if (!list.length) return current;
  const index = Math.max(0, list.indexOf(current));
  const size = list.length;
  return list[(((index + Math.trunc(delta)) % size) + size) % size];
}
