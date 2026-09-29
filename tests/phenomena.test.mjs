import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, DT, separation } from '../src/sim/engine.mjs';
import { capacity, energyStep, contactCost } from '../src/sim/energy.mjs';
import { decide, paths } from '../src/sim/tactics.mjs';
import { lineController } from '../src/sim/controller.mjs';
import { PHASES } from '../src/sim/race.mjs';

function scenario(role='leader') {
  const sim=new Simulation(1);const r=sim.riders.find(r=>r.role===role);
  sim.riders.forEach((o,i)=>Object.assign(o,{s:300+i*15,d:12,v:14,energy:100}));
  Object.assign(r,{s:100,d:2,v:15,reactionDelay:0,nextDecision:0});
  const members=sim.lines.find(l=>l.id===r.lineId).members.map(id=>sim.riders[id-1]);
  members.forEach((o,i)=>{o.s=100+(members.indexOf(r)-i)*5;o.d=2;});
  const w={time:30,releaseTime:0,remaining:550,phase:{id:'CONTEST'},pacer:{state:'retired'},
    riders:sim.riders,lineHeads:sim.lines.map(l=>sim.riders[l.members[0]-1]),lineMembers:members,
    baseTarget:r.baseFollowId?sim.riders[r.baseFollowId-1]:null,neighbors:[],width:20,
    obstacle:null,curvature:0,mergeBlocked:()=>false,distanceTo:o=>o.s-r.s};
  return {sim,r,w,refresh(){w.neighbors=sim.riders.filter(o=>o!==r).map(o=>({id:o.id,d:o.d,v:o.v,ds:o.s-r.s}));}};
}

test('identical reserve/capacity, drafting saves effort, acceleration/outside/contact cost energy',()=>{
  const s=new Simulation();assert.ok(s.riders.every(r=>r.energy===100));
  const base={v:18,w:0,d:2,energy:100,energyUsed:0};
  function load(extra={},sheltered=false,acceleration=0) {
    const r={...base,...extra};for(let i=0;i<1000;i++)energyStep(r,{dt:.01,guided:false,sheltered,acceleration,curvature:.03});return r.energy;
  }
  assert.ok(load({},true)>load());assert.ok(load({},false,1)<load());assert.ok(load({d:8})<load());
  const r={...base};contactCost(r,1);assert.ok(r.energy<100);
  assert.ok(capacity(20).speed<capacity(90).speed);assert.ok(capacity(20).acceleration<capacity(90).acceleration);
  energyStep(r,{dt:1,guided:true,sheltered:false,acceleration:2,curvature:.03});assert.equal(r.energy,99.3);
});

test('guided train retains current spacing and keeps asynchronous clocks through release',()=>{
  const s=new Simulation(6);for(let i=0;i<240*12;i++)s.step();
  assert.ok(s.riders.every(r=>r.d===s.pacer.d));
  for(let i=1;i<9;i++)assert.ok(separation(s.riders[i],s.riders[i-1]).ds>7.2);
  const timers=s.riders.map(r=>r.nextDecision);assert.ok(new Set(timers).size===9);
  const decisions=s.riders.map(r=>r.lastDecision);
  s.riders[0].s=1200;s.step();
  assert.equal(s.pacer.state,'exiting');assert.ok(s.riders.some((r,i)=>r.lastDecision===decisions[i]),'no broadcast change');
  s.riders.forEach((r,i)=>{if(timers[i]>s.time)assert.equal(r.lastDecision,decisions[i]);});
});

test('outside routes cannot cross an occupied lateral corridor instantaneously',()=>{
  const {r,w}=scenario();w.neighbors=[{ds:0,d:3.2},{ds:1,d:4.5}];
  assert.ok(paths(r,w).filter(p=>p.d>3).every(p=>!p.merge));
  r.nextDecision=999;r.targetD=6;r.action='MOVE_UP';w.mergeBlocked=()=>true;
  const c=lineController(r,w,()=>.1);assert.equal(c.lateral,0);
});

test('upward movement, control and resistance respond to opponents rather than identities',()=>{
  const a=scenario();a.sim.riders.filter(o=>o.lineId!==a.r.lineId).forEach(o=>o.s=50);
  a.r.action='MOVE_UP';decide(a.r,a.w,()=>.9);assert.equal(a.r.action,'CONTROL');
  const rival=a.w.lineHeads.find(o=>o!==a.r);rival.s=99;rival.d=3.3;rival.v=17;rival.action='MOVE_UP';
  a.r.action='HOLD';decide(a.r,a.w,()=>.8);assert.equal(a.r.action,'RESIST');
  a.r.stateSince=20;decide(a.r,a.w,()=>.8);assert.equal(a.r.action,'YIELD','prolonged parallel resistance ends');
});

test('kamashi accelerates harder than an ordinary upward move; makuri has observed stages/outcomes',()=>{
  const a=scenario();const rival=a.w.lineHeads.find(o=>o!==a.r);rival.s=120;rival.d=2;rival.v=14;
  a.sim.riders.filter(o=>o!==rival&&o.lineId!==a.r.lineId).forEach(o=>o.s=50);
  a.refresh();decide(a.r,a.w,()=>.01);assert.equal(a.r.action,'KAMASHI');assert.equal(a.r.attempt.stage,'OUTSIDE');
  a.r.attempt.stage='ACCELERATE';a.r.nextDecision=999;a.r.v=13;
  const strong=lineController(a.r,a.w,()=>.1).acceleration;a.r.action='MOVE_UP';
  const gentle=lineController(a.r,a.w,()=>.1).acceleration;assert.ok(strong>gentle);
  a.r.action='MAKURI';a.r.attempt.kind='MAKURI';a.r.s=126;decide(a.r,a.w,()=>.1);
  assert.equal(a.r.attempts[0].outcome,'success','success requires actual pass');
  a.r.s=100;a.r.energy=100;a.r.attackCooldown=0;a.w.remaining=350;a.w.time=40;
  decide(a.r,a.w,()=>.01);assert.equal(a.r.action,'MAKURI');
  a.w.time=47;a.r.energy=10;decide(a.r,a.w,()=>.1);assert.equal(a.r.attempts.at(-1).outcome,'failed');
});

test('second protects position with bounded lateral motion, then can pass a tiring leader',()=>{
  const a=scenario('second');a.w.remaining=300;
  const outsider=a.sim.riders.find(o=>o.lineId!==a.r.lineId);Object.assign(outsider,{s:a.r.s-3,d:3.2,v:17});a.refresh();
  decide(a.r,a.w,()=>.01);assert.equal(a.r.action,'BLOCK');assert.ok(a.r.targetD-a.r.d<=.6+.001);
  a.r.nextDecision=999;const c=lineController(a.r,a.w,()=>.1);assert.ok(Math.abs(c.lateral)<=.75);
  a.w.time=40;a.w.remaining=70;a.w.baseTarget.energy=15;a.r.energy=70;a.refresh();
  decide(a.r,a.w,()=>.1);assert.equal(a.r.action,'SPRINT');assert.equal(a.r.currentFollowId,null);
});

test('third can switch after a split and keep the new wheel instead of forced reunion',()=>{
  const a=scenario('third');a.r.split=true;a.w.baseTarget.s=a.r.s+30;
  const other=a.sim.riders.find(o=>o.lineId!==a.r.lineId);Object.assign(other,{s:a.r.s+6,d:a.r.d+1,v:16});a.refresh();
  decide(a.r,a.w,()=>.1);assert.equal(a.r.action,'SWITCH');assert.equal(a.r.currentFollowId,other.id);
  a.w.baseTarget.s=a.r.s+8;a.r.split=false;a.w.time++;
  decide(a.r,a.w,()=>.9);assert.equal(a.r.currentFollowId,other.id);
});

test('a rider with reserve is trapped if its front and lateral escape are blocked',()=>{
  const a=scenario('third');a.r.energy=100;a.r.d=.6;
  a.w.obstacle={id:1,gap:1,v:8,relativeSpeed:-7};
  a.w.neighbors=[.6,1.85,3.1,4.35,5.6].map(d=>({ds:2,d}));
  decide(a.r,a.w,()=>.5);assert.equal(a.r.action,'TRAPPED');
  a.r.nextDecision=999;const c=lineController(a.r,a.w,()=>.5);assert.ok(c.acceleration<0);
});

test('ten distinct spatial phases are defined; finish events are produced by crossings only',()=>{
  assert.equal(PHASES.length,10);assert.equal(new Set(PHASES.map(p=>p.id)).size,10);
  const s=new Simulation(4,()=>({acceleration:0,lateral:0}));s.pacer.state='retired';
  assert.deepEqual(s.result,[]);s.riders.forEach((r,i)=>{r.s=1900-i*10;r.v=1;r.d=3;});
  Object.assign(s.riders[4],{s:1999.99,v:10});s.step();assert.deepEqual(s.result,[5]);
  assert.ok(s.riders[4].finishTime>0&&s.riders[4].finishTime<DT);
});
