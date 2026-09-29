import { capacity } from './energy.mjs';
import { decide, choosePath } from './tactics.mjs';
export { choosePath } from './tactics.mjs';
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
export function followingAcceleration(speed,gap,relativeSpeed,desiredGap,gain=1) {
  return clamp(gain*.75*(gap-desiredGap)+1.6*relativeSpeed,-5,2.4);
}
export function lineController(r,world,random) {
  if(world.time<r.reactionDelay)return{acceleration:0,lateral:0};
  if(world.pacer.state==='guiding') {
    if(world.time>=r.nextDecision)r.nextDecision=world.time+.55+random()*.9;
    r.targetD=world.pacer.d;r.action='FOLLOW';r.reason='誘導中の一本棒を維持';
    const ahead=world.guideAhead;
    r.currentFollowId=ahead?.id??null;
    let acceleration=clamp((13.2-r.v)*.8,-5,1.8);
    if(ahead)acceleration=Math.min(acceleration,followingAcceleration(r.v,ahead.gap,ahead.relativeSpeed,
      Math.max(1.2,world.guidedCenterGap-1.9),1.15));
    if(world.obstacle)acceleration=Math.min(acceleration,followingAcceleration(r.v,world.obstacle.gap,
      world.obstacle.relativeSpeed,1.2+r.v*.12,r.response));
    return{acceleration,lateral:clamp((world.pacer.d-r.d)*1.1,-.55,.55)};
  }
  if(r.finishTime===null && world.time>=r.nextDecision) {
    r.nextDecision=world.time+.55+random()*.9;
    r.lastDecision=world.time;r.decisionPhase=world.phase.id;
    r.response=.8+random()*.4;
    decide(r,world,random);
  }
  const target=world.riders.find(o=>o.id===r.currentFollowId);
  const cap=capacity(r.energy);
  const speeds={HOLD:13.8,CONTROL:13.6,MOVE_UP:16.5,RESIST:18.6,YIELD:13,
    ATTACK:17.2,KAMASHI:20.6,MAKURI:20.1,FOLLOW:20.6,CHASE:20.6,SWITCH:20.6,
    BLOCK:18.5,SPRINT:20.6,TRAPPED:16};
  let cruise=Math.min(cap.speed,speeds[r.action]??14);
  if(r.action==='HOLD' && world.time-world.releaseTime<11)cruise=12.8;
  if(['CHASE','FOLLOW'].includes(r.action) && world.time-world.releaseTime<15)cruise=Math.min(cruise,17.5);
  if(r.attempt?.stage==='OUTSIDE')cruise=Math.min(cruise,(world.obstacle?.v??r.v)+.8);
  let acceleration=clamp((cruise-r.v)*.85,-5,Math.min(cap.acceleration,
    r.action==='KAMASHI'?2.4:r.action==='MOVE_UP'?1.1:1.8));
  const curve=world.curvature;
  r.desiredGap=(r.action==='BLOCK'?2.1:r.action==='CHASE'?.65:1.05)+r.v*.06+curve*r.v*.8;
  r.cohesion=r.action==='SPRINT'?0:1;
  if(target && r.action!=='SPRINT' && !['KAMASHI','MAKURI','MOVE_UP','RESIST','ATTACK','CONTROL'].includes(r.action)) {
    const gap=world.distanceTo(target)-1.9;
    if(gap < -1.9) acceleration=Math.min(acceleration,clamp((target.v-.8-r.v)*.7,-2,1));
    else acceleration=Math.min(acceleration,followingAcceleration(r.v,gap,target.v-r.v,r.desiredGap,r.response));
  }
  // An affiliation never overrides an actual obstacle in the current corridor.
  if(world.obstacle)acceleration=Math.min(acceleration,followingAcceleration(r.v,world.obstacle.gap,
    world.obstacle.relativeSpeed,.55+r.v*.055,r.response));
  r.targetD=clamp(r.targetD,.55,world.width-.55);
  let lateral=clamp((r.targetD-r.d)*.9,-.75,.75);
  if(world.mergeBlocked(lateral))lateral=0;
  return{acceleration,lateral};
}
export const toyController=lineController;
