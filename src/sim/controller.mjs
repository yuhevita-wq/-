// Decisions use a common positional snapshot. Safety and integration live in engine.mjs.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function followingAcceleration(speed, gap, relativeSpeed, desiredGap, gain = 1) {
  return clamp(gain * .75 * (gap - desiredGap) + 1.6 * relativeSpeed, -5, 1.8);
}

// After the pacer releases the field, search much farther across the bank.
// A crowding penalty plus a small random tie-breaker makes riders fan out
// instead of all choosing the same narrow corridor.
export function choosePath(rider, world, random = Math.random) {
  const offsets = [0, -1.4, 1.4, -2.8, 2.8, -4.4, 4.4];
  const options = [...new Set(offsets.map(offset => clamp(rider.d + offset, .6, world.width - .6)).map(v => v.toFixed(3)))].map(Number);

  return options.map(d => {
    let space = 50;
    let blocked = false;
    let crowding = 0;

    for (const other of world.neighbors) {
      const lateralDistance = Math.abs(other.d - d);
      if (Math.abs(other.ds) < 18 && lateralDistance < 1.35) crowding++;
      if (lateralDistance < 1.0 && other.ds > -2 && other.ds < 50) {
        space = Math.min(space, Math.max(0, other.ds - 1.9));
        if (other.ds < 3.4) blocked = true;
      }
    }

    const occupiedByLine = (world.lineHeads ?? []).some(h =>
      h.id !== rider.id && Math.abs(h.s - rider.s) < 24 && Math.abs(h.d - d) < 1.2
    );
    const edgeDistance = Math.min(d - .6, world.width - .6 - d);
    const edgePenalty = edgeDistance < 1.2 ? (1.2 - edgeDistance) * 4 : 0;
    const movePenalty = Math.abs(d - rider.d) * .16;
    const randomTieBreak = (random() - .5) * 2.8;

    return {
      d,
      space,
      score:
        Math.min(space, 30) -
        crowding * 6.5 -
        movePenalty -
        edgePenalty -
        (blocked ? 45 : 0) -
        (occupiedByLine ? 9 : 0) +
        randomTieBreak,
    };
  }).sort((a, b) => b.score - a.score)[0];
}

function decideLeader(rider, world, random) {
  const path = choosePath(rider, world, random);
  const rivals = world.lineHeads.filter(r => r.id !== rider.id);
  const ahead = rivals.filter(r => r.s > rider.s).sort((a, b) => a.s - b.s)[0];
  const alongside = rivals.some(r => Math.abs(r.s - rider.s) < 8 && Math.abs(r.d - rider.d) > .7);
  const congested = world.obstacle && world.obstacle.gap < rider.desiredGap + 2;
  const pressure = ahead ? ahead.s - rider.s : 0;
  const phase = world.phase.id;
  const late = ['C', 'D', 'E', 'F'].includes(phase);
  const support = world.lineMembers.filter(r => r.id !== rider.id);
  const stretched = support.some(r => rider.s - r.s > 20);
  const pacerSpace = world.pacer.s - rider.s;

  if (stretched && ['B', 'C'].includes(phase)) rider.action = 'DROP';
  else if (late && path.space > 9 && (pressure > 6 || alongside && ahead && rider.v > ahead.v + .3 || !ahead && world.remaining < 600)) rider.action = 'ATTACK';
  else if (congested && path.space < 6 && alongside) rider.action = 'DROP';
  else if ((phase !== 'A' && pressure > 5 || phase === 'B' && pacerSpace > 15) && path.space > 5) rider.action = 'ADVANCE';
  else rider.action = 'HOLD';

  if (rider.action === 'ATTACK' || rider.action === 'ADVANCE') rider.targetD = path.d;
  else if (rider.action === 'DROP') rider.targetD = rider.d;

  // Once the pacer is gone, leaders are allowed to hunt for open road even
  // without a full attack. This is what creates the visible fan-out.
  if (late && path.space > 5 && (congested || random() < .58)) rider.targetD = path.d;
}

export function lineController(rider, world, random) {
  if (world.time < rider.reactionDelay) return { acceleration: 0, lateral: 0 };
  rider.desiredGap = .9 + rider.v * .15 + rider.gapOffset;

  // Before the pacer releases the field, every rider follows the exact rider
  // immediately ahead at a deliberately large visual gap. This keeps the
  // oversized board-game bicycle pieces from overlapping while preserving one file.
  if (world.pacer.state === 'guiding') {
    rider.targetD = world.pacer.d;
    const ahead = world.guideAhead;
    let acceleration = clamp((13.2 - rider.v) * .8, -5, 1.8);
    if (ahead) {
      const desiredGap = Math.max(1.2, world.guidedCenterGap - 1.9);
      acceleration = Math.min(
        acceleration,
        followingAcceleration(rider.v, ahead.gap, ahead.relativeSpeed, desiredGap, 1.15)
      );
    }
    if (world.obstacle) {
      acceleration = Math.min(
        acceleration,
        followingAcceleration(rider.v, world.obstacle.gap, world.obstacle.relativeSpeed, 1.2 + rider.v * .12, rider.response)
      );
    }
    const lateral = clamp((world.pacer.d - rider.d) * 1.1, -.55, .55);
    return { acceleration, lateral };
  }

  if (world.time >= rider.nextDecision) {
    rider.nextDecision = world.time + .65 + random() * .85;
    rider.lastDecision = world.time;
    rider.decisionPhase = world.phase.id;
    rider.speedOffset = (random() - .5) * .7;
    rider.gapOffset = (random() - .5) * .35;
    rider.response = .85 + random() * .3;

    // Line cohesion now starts relaxing immediately after pacer release rather
    // than remaining almost rigid until the final 200 m.
    rider.cohesion = clamp((world.remaining - 80) / 900, .08, .82);

    const openPath = choosePath(rider, world, random);
    if (rider.role === 'leader') {
      decideLeader(rider, world, random);
    } else {
      const phaseOpen = ['C', 'D', 'E', 'F'].includes(world.phase.id);
      const compressed = world.obstacle && world.obstacle.gap < rider.desiredGap + 6;
      const usefulShift = Math.abs(openPath.d - rider.d) > 1.0;
      if (phaseOpen && openPath.space > 3 && (compressed || usefulShift && random() < .74)) {
        rider.targetD = openPath.d;
      }
    }
  }

  let cruise = 14.2;
  if (rider.role === 'leader') cruise += ({ HOLD: 0, ADVANCE: .9, DROP: -1.7, ATTACK: 2.8 })[rider.action];
  else cruise += 3.6;
  cruise += (1 - rider.cohesion) * 2.5 + rider.speedOffset;

  let acceleration = clamp((cruise - rider.v) * .8, -5, 1.8);
  const target = world.front;
  if (target) {
    const follow = followingAcceleration(rider.v, target.gap, target.relativeSpeed, rider.desiredGap, rider.response);
    const weight = rider.role === 'leader' ? 1 : rider.cohesion;
    acceleration = Math.min(acceleration, weight * follow + (1 - weight) * acceleration);
    if (rider.role !== 'leader' && rider.cohesion >= .8 && world.baseTarget) rider.targetD = world.baseTarget.d;
  }

  if (world.obstacle) {
    acceleration = Math.min(
      acceleration,
      followingAcceleration(rider.v, world.obstacle.gap, world.obstacle.relativeSpeed, .7 + rider.v * .12, rider.response)
    );
  }

  rider.targetD = clamp(rider.targetD, .55, world.width - .55);
  let lateral = clamp((rider.targetD - rider.d) * 1.05, -1.05, 1.05);

  // Do not freeze lateral movement completely when another rider is near.
  // Slow the merge instead, so the pack keeps flowing sideways around traffic.
  if (world.mergeBlocked(lateral)) lateral *= .28;

  return { acceleration, lateral };
}

export const toyController = lineController;
