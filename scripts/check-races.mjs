import { Simulation, DT, BODY, separation } from '../src/sim/engine.mjs';
import assert from 'node:assert/strict';
import { PHASES } from '../src/sim/race.mjs';
export function inspectRace(seed) {
  const s=new Simulation(seed);const phases=new Set();
  const gaps=s.lines.map(()=>({min:Infinity,max:0}));let formed=false,backward=false,minSeparation=Infinity;
  let leadersAt200=null;let firstFormation=null;
  for(let n=0;n<240*280&&!s.done;n++) {
    const old=s.riders.map(r=>r.s);s.step();phases.add(s.phase.id);
    if(s.pacer.state!=='guiding')for(let i=0;i<9;i++)if(s.riders[i].s<old[i]-1e-6)backward=true;
    if(n%120!==0)continue;
    let connected=0;
    s.lines.forEach((l,i)=>{
      const cars=l.members.map(id=>s.riders[id-1]);
      if(cars.every((r,j)=>!j || cars[j-1].s>r.s && cars[j-1].s-r.s<18 && Math.abs(cars[j-1].d-r.d)<1.3))connected++;
      if(s.pacer.state!=='guiding'){const gap=cars[0].s-cars[1].s;gaps[i].min=Math.min(gaps[i].min,gap);gaps[i].max=Math.max(gaps[i].max,gap);}
    });
    if(s.pacer.state!=='guiding'&&s.phase.id!=='STRAIGHT'&&connected>=2){formed=true;firstFormation??=s.time;}
    if(!leadersAt200&&Math.max(...s.riders.map(r=>r.s))>=1800)leadersAt200=[...s.riders].sort((a,b)=>b.s-a.s).map(r=>r.id);
    for(let i=0;i<9;i++)for(let j=i+1;j<9;j++) {const {ds,dd}=separation(s.riders[i],s.riders[j]);minSeparation=Math.min(minSeparation,Math.hypot(ds/BODY.length,dd/BODY.width));}
  }
  const attempts=s.riders.flatMap(r=>[...r.attempts,...(r.attempt?[{...r.attempt,outcome:r.s>s.riders[r.attempt.targetId-1].s+4?'success':'failed'}]:[])].map(a=>({id:r.id,...a})));
  const states=[...new Set(s.events.filter(e=>e.type==='state').map(e=>e.state))];
  const attacks=s.events.filter(e=>['KAMASHI','MAKURI'].includes(e.state));
  const firstAttacks=s.lines.map(l=>attacks.find(e=>e.id===l.members[0])?.time??null);
  const winner=s.riders[s.result[0]-1];
  return {seed,done:s.done,result:s.result,states,phases:[...phases],formed,
    stretch:gaps.some(g=>g.max-g.min>3),split:s.events.some(e=>e.type==='split'),
    makuriSuccess:attempts.some(a=>a.kind==='MAKURI'&&a.outcome==='success'),
    makuriFailed:attempts.some(a=>a.kind==='MAKURI'&&a.outcome==='failed'),
    leaderWon:winner?.role==='leader',secondWon:winner?.role==='second',
    leaderHeld:winner?.role==='leader'&&leadersAt200?.[0]===winner.id,
    secondPass:s.riders.some(r=>r.role==='second'&&leadersAt200?.indexOf(r.id)>leadersAt200?.indexOf(r.baseFollowId)&&s.result.indexOf(r.id)<s.result.indexOf(r.baseFollowId)),firstFormation,
    switch:states.includes('SWITCH'),trapped:states.includes('TRAPPED'),firstAttacks,
    finishChanged:leadersAt200?.join()!==s.result.join(),backward,minSeparation,
    energy:s.riders.map(r=>+r.energy.toFixed(1)),attempts:attempts.map(a=>({id:a.id,kind:a.kind,outcome:a.outcome,time:+a.start.toFixed(2)}))};
}
if(process.argv[1]?.endsWith('check-races.mjs')) {
  const count=Number(process.argv[2]??10),rows=[];
  for(let seed=1;seed<=count;seed++){const row=inspectRace(seed);rows.push(row);console.log(JSON.stringify(row));}
  const flags=['formed','stretch','split','makuriSuccess','makuriFailed','leaderWon','secondWon','leaderHeld','secondPass','switch','trapped','finishChanged'];
  if(count>=10)validateRaces(rows);
  console.log(JSON.stringify({summary:Object.fromEntries(flags.map(k=>[k,rows.filter(r=>r[k]).length])),uniqueResults:new Set(rows.map(r=>r.result.join())).size,allFinished:rows.every(r=>r.done)}));
}

export function validateRaces(rows) {
  assert.ok(rows.length>=10);
  for(const r of rows) {
    assert.ok(r.done,`seed ${r.seed}: all nine finish`);
    assert.equal(new Set(r.result).size,9);
    assert.equal(r.backward,false,`seed ${r.seed}: no rear bounce after guidance`);
    assert.ok(r.minSeparation>.999,`seed ${r.seed}: no body overlap`);
    assert.deepEqual(r.phases,PHASES.map(p=>p.id));
    const times=r.firstAttacks.filter(t=>t!==null);
    if(times.length>1)assert.ok(new Set(times).size>1,'no simultaneous offensive switch');
  }
  assert.ok(new Set(rows.map(r=>r.result.join())).size>3,'different observed outcomes');
  for(const key of ['formed','stretch','split','makuriSuccess','makuriFailed','leaderHeld','secondPass','switch','trapped','finishChanged'])
    assert.ok(rows.some(r=>r[key]),`missing natural phenomenon: ${key}`);
  const states=new Set(rows.flatMap(r=>r.states));
  for(const action of ['MOVE_UP','CONTROL','RESIST','KAMASHI','MAKURI','BLOCK','SWITCH','SPRINT','TRAPPED'])
    assert.ok(states.has(action),`missing natural action: ${action}`);
}
