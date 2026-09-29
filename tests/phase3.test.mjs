import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, DT, BODY, separation } from '../src/sim/engine.mjs';
import { lineController } from '../src/sim/controller.mjs';
import { DEFAULT_LINES, PHASES, phaseAt } from '../src/sim/race.mjs';
const coast = () => ({ acceleration: 0, lateral: 0 });
function arranged() {
  const sim = new Simulation(8, coast);
  sim.pacer.state='retired';
  sim.riders.forEach((r,i)=>{r.s=250+i*10;r.d=5;r.v=10;});
  for(const [index,line] of sim.lines.entries()) line.members.forEach((id,order)=>{
    Object.assign(sim.riders[id-1],{s:100-order*5-index*25,d:1+index*2,v:10});
  });
  return sim;
}
function steps(sim,seconds) { for(let n=0;n<seconds/DT;n++)sim.step(); }

test('line data can change, validates membership, and assigns explicit roles/targets',()=>{
  const a=new Simulation();assert.deepEqual(a.lines.map(l=>l.members),DEFAULT_LINES.map(l=>[...l.members]));
  const lines=[{id:'X',members:[9,1,2]},{id:'Y',members:[8,3,4]},{id:'Z',members:[7,5,6]}];
  const b=new Simulation(1,lineController,{lines});
  assert.equal(b.riders[0].role,'second');assert.equal(b.riders[0].baseFollowId,9);
  assert.equal(b.riders[1].role,'third');assert.equal(b.riders[1].baseFollowId,1);
  lines[0].members[0]=5;assert.equal(b.lines[0].members[0],9,'config copied');
  assert.throws(()=>new Simulation(1,lineController,{lines}));
});

test('second and third retain affiliated targets despite nearer other-line riders',()=>{
  const s=arranged();const second=s.riders[4],third=s.riders[6];
  s.riders[2].s=second.s+2;s.riders[2].d=second.d+1.1;
  s.riders[7].s=third.s+2;s.riders[7].d=third.d+1.1;
  steps(s,1);
  assert.equal(second.currentFollowId,1);assert.equal(third.currentFollowId,5);
  assert.equal(second.baseFollowId,1);assert.equal(third.baseFollowId,5);
  assert.equal(second.split,false);
});

test('unaffiliated traffic still causes safe deceleration without target stealing',()=>{
  const s=arranged();s.controller=lineController;
  const r=s.riders[4];r.reactionDelay=0;r.nextDecision=999;r.s=0;r.d=3;r.v=14;
  Object.assign(s.riders[0],{s:15,d:3,v:14});
  Object.assign(s.riders[2],{s:3,d:3,v:5});
  s.step();assert.equal(r.currentFollowId,1);assert.ok(r.v<14);
});

test('sustained gap, lateral displacement and insertion split a line; reconnection is hysteretic',()=>{
  for(const reason of ['gap','lateral','inserted']) {
    const s=arranged(),r=s.riders[4],base=s.riders[0];
    if(reason==='gap')base.s=r.s+30;
    if(reason==='lateral')base.d=r.d+3;
    if(reason==='inserted')Object.assign(s.riders[2],{s:r.s+2.4,d:r.d,v:10});
    steps(s,1);assert.equal(r.split,false,'not instantaneous');
    steps(s,1);assert.equal(r.split,true);assert.equal(r.splitReason,reason);
    assert.equal(s.lines[0].split,true);assert.equal(r.baseFollowId,1);
    s.riders[2].s=r.s-60;base.s=r.s+5;base.d=r.d;
    steps(s,.5);assert.equal(r.split,true,'rejoin needs persistence');
    steps(s,.6);assert.equal(r.split,false);assert.equal(r.currentFollowId,1);
  }
});

test('phase boundaries are configurable and are not a broadcast action switch',()=>{
  for(const p of PHASES.slice(1)) {
    assert.equal(phaseAt(p.remaining).id,p.id);
    assert.notEqual(phaseAt(p.remaining+.01).id,p.id);
  }
  assert.equal(phaseAt(900,[{id:'A',remaining:Infinity},{id:'B',remaining:950}]).id,'B');
  const s=arranged();s.controller=lineController;
  s.riders.forEach((r,i)=>{r.nextDecision=1+i*.1;r.reactionDelay=0;r.action=r.role==='leader'?'HOLD':'FOLLOW';});
  s.riders[0].s=1600;const before=s.riders.map(r=>[r.nextDecision,r.action,r.lastDecision]);
  s.step();assert.equal(s.phase.id,'FINAL');assert.ok(s.free);
  assert.deepEqual(s.riders.map(r=>[r.nextDecision,r.action,r.lastDecision]),before);
});

test('an attacking leader is followed through affiliation, with delayed independent motion',()=>{
  const s=arranged();s.controller=lineController;
  const head=s.riders[0],second=s.riders[4],third=s.riders[6];
  head.action='ATTACK';head.nextDecision=999;
  s.riders.forEach(r=>r.reactionDelay=0);
  second.reactionDelay=.6;third.reactionDelay=1;
  const before=[head.v,second.v,third.v];steps(s,.3);
  assert.ok(head.v>before[0]);assert.equal(second.v,before[1]);assert.equal(third.v,before[2]);
  steps(s,2);assert.equal(second.currentFollowId,head.id);assert.equal(third.currentFollowId,second.id);
  assert.ok(second.v>before[1]);assert.ok(third.v>before[2]);
  assert.notEqual(head.s-second.s,second.s-third.s,'not rigid distances');
});
