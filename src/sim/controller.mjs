// Replace only this controller to add future rider decisions. No rankings enter physics.
export function toyController(rider, world, random) {
  if (world.time >= rider.nextDecision) {
    rider.nextDecision = world.time + .25 + random()*.65;
    rider.targetSpeed = (world.free ? 15.5 : 13) + (random()-.5)*4;
    rider.wander = (random()-.5)*1.8;
    if (!world.free && random()<.22) rider.targetLane=Math.max(1,Math.min(9,rider.targetLane+(random()<.5?-1:1)));
  }
  return {acceleration: Math.max(-3,Math.min(2.4,(rider.targetSpeed-rider.v)*1.1)), lateral:world.free ? rider.wander : 0};
}
