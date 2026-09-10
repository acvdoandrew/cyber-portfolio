const clamp = (value: number) => Math.min(1, Math.max(0, value));
const smooth = (value: number) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};

/** Slow, continuous formation; attention steadies it without a sudden snap. */
export function manifestationAt(seconds: number, attention: number) {
  const time = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const focus = clamp(Number.isFinite(attention) ? attention : 0);
  const arrival = smooth(time / 6);
  const reconsideration = Math.pow(0.5 + 0.5 * Math.sin(time * 0.27 - 1.7), 3);
  const coherence = clamp(0.32 + arrival * 0.57 - reconsideration * 0.24 + focus * 0.2);
  return {
    coherence,
    label: focus > 0.55
      ? 'Recognizing you'
      : coherence < 0.48
        ? 'Gathering fragments'
        : coherence < 0.75
          ? 'Taking shape'
          : 'Almost familiar',
  };
}
