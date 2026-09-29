// Decisions use a common positional snapshot. Safety and integration live in engine.mjs.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function followingAcceleration(speed, gap, relativeSpeed, desiredGap, gain = 1) {
  return clamp(gain * .75 * (gap - desiredGap) + 1.6 * relativeSpeed, -5, 1.8);
}

// Score continuous lateral destinations by available forward space and merge safety.
// No line ID or rider number participates in this choice.
export function choosePath(rider, world) {
  const options = [rider.d, rider.d - 1.15, rider.d + 1.15, rider.d - 2.3, rider.d + 2.3]
    .map(d => clamp(d, .6, world.width - .6));
  return options.map(d => {
    let space = 45, blocked = false;
    for (const other of world.neighbors) {
      if (Math.abs(other.d - d) < .9 && other.ds > -2 && other.ds < 45) {
        space = Math.min(space, Math.max(0, other.ds - 1.9));
        if (other.ds < 3) blocked = true;
      }
    }
    const occupiedByLine = (world.lineHeads ?? []).some(h => h.id !== rider.id && Math.abs(h.s-rider.s)<25 && Math.abs(h.d-d)<1);
    return { d, space, score: Math.min(space, 24) - Math.abs(d - rider.d) * .6 - d * .7 - (blocked ? 50 : 0) - (occupiedByLine ? 15 : 0) };
  }).sort((a, b) => b.score - a.score)[0];
}

function decideLeader(rider, world) {
  const path = choosePath(rider, world);
  const rivals = world.lineHeads.filter(r => r.id !== rider.id);
  const ahead = rivals.filter(r => r.s > rider.s).sort((a,b) => a.s-b.s)[0];
  const alongside = rivals.some(r => Math.abs(r.s-rider.s)<8 && Math.abs(r.d-rider.d)> .7);
  const congested = world.obstacle && world.obstacle.gap < rider.desiredGap + 2;
  const pressure = ahead ? ahead.s - rider.s : 0;
  const phase = world.phase.id;
  const late = ['C','D','E','F'].includes(phase);
  const support = world.lineMembers.filter(r => r.id !== rider.id);
  const stretched = support.some(r => rider.s - r.s > 20);
  const pacerSpace = world.pacer.s - rider.s;
  // An attack needs room and an observed positional reason. Its time is not preselected.
  if (stretched && ['B','C'].includes(phase)) {
    rider.action = 'DROP';
  } else if (late && path.space > 9 && (pressure > 6 || alongside && ahead && rider.v > ahead.v + .3 || !ahead && world.remaining < 600)) {
    rider.action = 'ATTACK';
  } else if (congested && path.space < 6 && alongside) {
    rider.action = 'DROP';
  } else if ((phase !== 'A' && pressure > 5 || phase === 'B' && pacerSpace > 15) && path.space > 5) {
    rider.action = 'ADVANCE';
  } else {
    rider.action = 'HOLD';
  }
  if (rider.action === 'ATTACK' || rider.action === 'ADVANCE') rider.targetD = path.d;
  else if (rider.action === 'DROP') {
    // Stay in the current corridor while yielding longitudinal space.
    rider.targetD = rider.d;
  }
  if (world.time > 6 && rivals.some(h => Math.abs(h.s-rider.s)<25 && Math.abs(h.d-rider.d)<1)) rider.targetD = path.d;
  // Keep an independent lateral corridor in formation rather than converging on the pacer.
}

export function lineController(rider, world, random) {
  if (world.time < rider.reactionDelay) return { acceleration: 0, lateral: 0 };
  rider.desiredGap = .9 + rider.v * .15 + rider.gapOffset;
  if (world.time >= rider.nextDecision) {
    rider.nextDecision = world.time + .8 + random() * 1.1;
    rider.lastDecision = world.time;
    rider.decisionPhase = world.phase.id;
    rider.speedOffset = (random() - .5) * .7;
    rider.gapOffset = (random() - .5) * .35;
    rider.response = .85 + random() * .3;
    // Relax relationships progressively in the final 200 m, at each rider's own decision.
    rider.cohesion = clamp(world.remaining / 200, 0, 1);
    if (rider.role === 'leader') decideLeader(rider, world);
    else if (rider.cohesion < .85 && world.obstacle && world.obstacle.gap < rider.desiredGap + 3) {
      rider.targetD = choosePath(rider, world).d;
    }
  }
  const paced = world.pacer.state === 'guiding';
  let cruise = paced ? 13.2 : 14.2;
  if (rider.role === 'leader') {
    cruise += ({ HOLD: 0, ADVANCE: .9, DROP: -1.7, ATTACK: 2.8 })[rider.action];
  } else {
    // Catch-up headroom is a positional controller, not a permanent ability advantage.
    cruise += 3.6;
  }
  cruise += (1 - rider.cohesion) * 2.5 + rider.speedOffset;
  let acceleration = clamp((cruise - rider.v) * .8, -5, 1.8);
  const target = world.front;
  if (target) {
    const follow = followingAcceleration(rider.v, target.gap, target.relativeSpeed, rider.desiredGap, rider.response);
    // Safety remains full-strength below. Only affiliation fades approaching the finish.
    const weight = rider.role === 'leader' ? 1 : rider.cohesion;
    acceleration = Math.min(acceleration, weight * follow + (1 - weight) * acceleration);
    if (rider.role !== 'leader' && rider.cohesion >= .85) rider.targetD = world.baseTarget.d;
  }
  if (world.obstacle) acceleration = Math.min(acceleration,
    followingAcceleration(rider.v, world.obstacle.gap, world.obstacle.relativeSpeed, .7 + rider.v * .12, rider.response));
  if (paced) {
    const gap = world.pacer.s - rider.s - 1.9;
    acceleration = Math.min(acceleration, followingAcceleration(rider.v, gap, world.pacer.v-rider.v, 2.7));
  }
  rider.targetD = clamp(rider.targetD, .55, world.width - .55);
  let lateral = clamp((rider.targetD - rider.d) * .75, -.55, .55);
  if (world.mergeBlocked(lateral)) lateral = 0;
  return { acceleration, lateral };
}
// Retained export for callers using the Phase 2 controller entry point.
export const toyController = lineController;
