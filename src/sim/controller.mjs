// Decisions receive a read-only-in-practice snapshot: all riders observe the same step.
// No rider ability, tactics, or finish-order sampling is used here.
import { lane } from './track.mjs';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function followingAcceleration(speed, gap, relativeSpeed, desiredGap, gain = 1) {
  return clamp(gain * .75 * (gap - desiredGap) + 1.6 * relativeSpeed, -5, 1.8);
}

export function toyController(rider, world, random) {
  if (world.time < rider.reactionDelay) return { acceleration: 0, lateral: 0 };
  if (world.time >= rider.nextDecision) {
    rider.nextDecision = world.time + .7 + random() * .7;
    rider.speedOffset = (random() - .5) * 1.2;
    rider.gapOffset = (random() - .5) * .3;
    rider.response = .85 + random() * .3;
  }
  const paced = world.pacer.state === 'guiding';
  const target = world.front;
  const desiredGap = 1 + rider.v * .18 + rider.gapOffset;
  rider.desiredGap = desiredGap;
  const cruise = (paced ? 13.5 : world.free ? 16.2 : 14) + rider.speedOffset;
  let acceleration = clamp((cruise - rider.v) * .8, -5, 1.8);
  if (target) acceleration = Math.min(acceleration,
    followingAcceleration(rider.v, target.gap, target.relativeSpeed, desiredGap, rider.response));

  // While guided, settle behind the observed front vehicle, not on a prescribed column.
  // The initial reaction differences form the order; no immutable rider ordering exists.
  if (paced) {
    const d = target ? target.d : world.pacer.d;
    let closest = 1;
    for (let i = 2; i <= 9; i++)
      if (Math.abs(lane(rider.s, i) - d) < Math.abs(lane(rider.s, closest) - d)) closest = i;
    rider.targetLane = closest;
  } else if (world.time >= rider.nextPathDecision) {
    rider.nextPathDecision = world.time + 2 + random() * 2;
    if (world.free) {
      rider.targetD = clamp(rider.d + (random() - .5) * 1.8, .55, world.width - .55);
    } else if (target && target.gap < desiredGap + 3) {
      // Basic space selection, not a rider-specific overtaking strategy.
      rider.targetLane = clamp(rider.targetLane + (random() < .5 ? -1 : 1), 1, 9);
    }
  }
  const desiredD = world.free ? rider.targetD : lane(rider.s, rider.targetLane);
  let lateral = clamp((desiredD - rider.d) * .8, -.5, .5);
  // Do not merge into the rear wheel of a nearby vehicle. Parallel side contact remains possible.
  if (world.mergeBlocked(lateral)) lateral = 0;
  return { acceleration, lateral };
}
