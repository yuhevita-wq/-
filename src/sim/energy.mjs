// All riders share these constants. Reserve is race history, never innate ability.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function capacity(energy = 100) {
  const fraction = clamp(energy / 100, 0, 1);
  return { speed: 12.8 + 7.8 * Math.sqrt(fraction), acceleration: .65 + 1.75 * fraction };
}
export function energyStep(rider, { dt, guided, sheltered, curvature, acceleration }) {
  if (guided) return;
  const drag = .09 * Math.max(0, rider.v - 11) ** 1.6 * (sheltered ? .65 : 1);
  const surge = Math.max(0, acceleration) * .4;
  const outside = Math.max(0, curvature * rider.d) * rider.v * .18;
  const recover = sheltered && acceleration < .2 && rider.v < 16 ? .3 : 0;
  const cost = dt * (.04 + drag + surge + outside + Math.abs(rider.w) * .16 - recover);
  rider.energy = clamp(rider.energy - cost, 0, 100);
  rider.energyUsed += Math.max(0, cost);
  rider.sheltered = sheltered;
}
export function contactCost(rider, strength) {
  const cost = strength * .7;
  rider.energy = Math.max(0, rider.energy - cost);
  rider.energyUsed += cost;
}
