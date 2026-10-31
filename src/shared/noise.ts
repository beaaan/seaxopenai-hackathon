/**
 * Smallest change CI reports. A measured band can be ~0 when readings saturate (every pair at P≈1); without a floor a
 * 0.01 wobble would count as a real change. Shared so the UI marks exactly the changes the verdict counted.
 */
export const MIN_EFFECT = 0.05;

/** The band a change must exceed: the measured test–retest band, floored at `MIN_EFFECT`. */
export function effectiveBand(noiseBand: number): number {
  return Math.max(noiseBand, MIN_EFFECT);
}

/** Whether `delta` lies beyond `band` (a change equal to the band is within noise; rates are floating-point means). */
export function beyondNoise(delta: number, noiseBand: number): boolean {
  return Math.abs(delta) > effectiveBand(noiseBand) + Number.EPSILON;
}
