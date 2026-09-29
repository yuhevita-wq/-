import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, DT, BODY, separation } from '../src/sim/engine.mjs';
import { followingAcceleration } from '../src/sim/controller.mjs';
import { TRACK } from '../src/sim/track.mjs';
const coast = () => ({ acceleration: 0, lateral: 0 });
function isolated(seed=3) {
  const s = new Simulation(seed, coast);
  s.pacer.state = 'retired';
  s.riders.forEach((r,i)=>{r.s=100+i*25;r.d=3;r.v=10;});
  return s;
}

test('pacer is separate from nine riders, starts ahead, and is not ranked',()=>{
  const s=new Simulation(1);
  assert.equal(s.riders.length,9);assert.equal(s.pacer.id,'pacer');
  assert.ok(s.pacer.s>Math.max(...s.riders.map(r=>r.s)));
  assert.equal(s.pacer.state,'guiding');assert.deepEqual(s.result,[]);
  assert.ok(s.riders.every(r=>r.finishTime===null));
});

test('pacer starts exiting at leader remaining 800m and moves continuously to permanent retirement',()=>{
  const s=isolated();s.pacer.state='guiding';s.pacer.s=1208;s.pacer.d=1.6;s.pacer.v=11.5;
  s.riders[0].s=1199.8;s.step();assert.equal(s.pacer.state,'guiding');
  s.riders[0].s=1200;const previousD=s.pacer.d;s.step();
  assert.equal(s.pacer.state,'exiting');assert.ok(s.pacer.d<previousD);
  assert.ok(previousD-s.pacer.d<.01);assert.ok(s.pacer.exitStartedAt!==null);
  for(let i=0;i<240*7;i++)s.step();
  assert.equal(s.pacer.state,'retired');assert.equal(s.pacer.d,-4);
  const parked=s.pacer.s;for(let i=0;i<100;i++)s.step();assert.equal(s.pacer.s,parked);
  assert.ok(!s.result.includes('pacer'));
});

test('gap feedback decelerates on closing, accelerates with space, and responds to relative speed',()=>{
  assert.ok(followingAcceleration(12,1,-2,3)<0);
  assert.ok(followingAcceleration(12,9,0,3)>0);
  assert.ok(followingAcceleration(12,3,-1,3)<followingAcceleration(12,3,1,3));
  const close=isolated(),far=isolated();
  for(const s of [close,far]){s.controller = new Simulation().controller;s.riders[0].reactionDelay=0;s.riders[0].s=0;s.riders[1].v=8;}
  close.riders[1].s=3;far.riders[1].s=16;
  close.step();far.step();
  assert.ok(close.riders[0].v<10);assert.ok(far.riders[0].v>10);
  assert.equal(close.riders[0].frontId,2);assert.ok(close.riders[0].frontGap!==null);
  assert.equal(close.riders[0].relativeSpeed,-2);
});

test('fast rear approach cannot pass through or rebound; no contact impulse or front push',()=>{
  const s=isolated();s.riders[0].s=0;s.riders[1].s=4;s.riders[0].v=22;s.riders[1].v=2;
  let last=s.riders[0].s;
  for(let i=0;i<500;i++){
    s.step();assert.ok(s.riders[0].s>=last-1e-8);last=s.riders[0].s;
    assert.ok(separation(s.riders[0],s.riders[1]).ds>=BODY.length-1e-5);
    assert.equal(s.riders[1].v,2);assert.equal(s.riders[0].w,0);
  }
  assert.equal(s.contacts,0);assert.equal(s.sideContacts,0);
});

test('side contact separates laterally, uses seeded local randomness and respects contact intensity',()=>{
  function hit(seed,w){const s=isolated(seed);s.riders[1].s=s.riders[0].s;s.riders[1].d=3.64;s.riders[0].w=w;s.riders[1].w=-w;s.step();return s;}
  const a=hit(4,.6),again=hit(4,.6),b=hit(5,.6),soft=hit(4,.1);
  assert.equal(a.sideContacts,1);assert.deepEqual(a.riders,again.riders);
  assert.notEqual(a.riders[0].v,b.riders[0].v);
  assert.ok(Math.abs(a.riders[1].d-a.riders[0].d)>=BODY.width-1e-5);
  assert.ok(a.riders[0].v<soft.riders[0].v);
  assert.equal(a.result.length,0);
});

test('guided formation emerges, preserves gaps, transitions in order, and all nine finish',()=>{
  const s=new Simulation(29);let formed=false,exit=false,free=false,gapMin=Infinity,gapMax=-Infinity;
  for(let n=0;n<240*260&&!s.done;n++){
    const old=s.riders.map(r=>r.s);s.step();
    s.riders.forEach((r,i)=>assert.ok(r.s>=old[i]-1e-7,'no backward bounce'));
    if(s.time>45&&s.time<65){
      const sorted=[...s.riders].sort((a,b)=>b.s-a.s);
      // Phase 3 intentionally replaces the single-file corridor with multiple lines.
      assert.ok(Math.max(...sorted.map(r=>r.d))-Math.min(...sorted.map(r=>r.d))>1,'multiple lateral corridors');
      assert.ok(sorted.every(r=>r.frontId!==null));
      assert.ok(s.pacer.s>sorted[0].s);
      const gap=sorted[3].frontGap;gapMin=Math.min(gapMin,gap);gapMax=Math.max(gapMax,gap);formed=true;
    }
    if(s.pacer.state==='exiting')exit=true;
    if(s.free){assert.ok(exit,'pacer exits before lane release');free=true;}
    if(!s.result.length)assert.ok(s.riders.every(r=>r.finishTime===null));
  }
  assert.ok(formed&&exit&&free&&s.done);
  assert.ok(gapMax-gapMin>.05,'gaps vary rather than a rigid coordinate column');
  assert.equal(s.result.length,9);assert.equal(new Set(s.result).size,9);
  const ordered=s.result.map(id=>s.riders.find(r=>r.id===id).finishTime);
  assert.deepEqual(ordered,[...ordered].sort((a,b)=>a-b));
  assert.equal(s.pacer.state,'retired');
});
