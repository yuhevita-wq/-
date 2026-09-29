// Tactical goals only: never writes a position, velocity, finish time or result.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const OFFENSIVE = new Set(['KAMASHI', 'MAKURI']);
export function paths(r, w) {
  const candidates = [...new Set([r.d, r.d - 1.25, r.d + 1.25, r.d - 2.5, r.d + 2.5, r.d - 3.75, r.d + 3.75, r.d - 5, r.d + 5]
    .map(d => clamp(d, .6, w.width - .6)))];
  return candidates.map(d => {
    let space = 60, rearSpace = 60, merge = true;
    for (const o of w.neighbors) {
      if (Math.abs(o.d - d) < .85) {
        if (o.ds > 0) space = Math.min(space, o.ds - 1.9);
        else rearSpace = Math.min(rearSpace, -o.ds - 1.9);
      }
      // A target beyond a neighbor is not a license to cross through that neighbor.
      if (Math.abs(o.ds) < 3.2 && o.d >= Math.min(r.d,d)-.65 && o.d <= Math.max(r.d,d)+.65) merge = false;
    }
    return { d, space, merge, rearSpace, score: Math.min(24,space) - Math.abs(d-r.d)*.8 - d*.35 - (merge ? 0 : 35) };
  });
}
export function choosePath(r, w) { return paths(r,w).sort((a,b)=>b.score-a.score)[0]; }
function outerPath(r,w,target) {
  return paths(r,w).filter(p=>p.d >= (target?.d ?? r.d)+.95 && p.merge)
    .sort((a,b)=>b.score-a.score)[0];
}
function setState(r,w,action,reason,d=r.targetD,followId=r.currentFollowId) {
  if (action !== r.action) r.stateSince = w.time;
  r.action=action; r.reason=reason; r.targetD=clamp(d,.55,w.width-.55);
  r.currentFollowId=followId;
  r.targetPosition = `${r.targetD.toFixed(1)}m / ${followId == null ? '空いた前方' : followId+'の後ろ'}`;
}
function startAttempt(r,w,action,target,path) {
  r.attempt={kind:action,targetId:target.id,start:w.time,startGap:target.s-r.s,
    bestGap:target.s-r.s,lastProgress:w.time,stage:'OUTSIDE',outcome:null};
  setState(r,w,action,action==='KAMASHI'?'速度差と空いた外進路から急加速':'前方ラインを外から追い上げる',path.d,null);
}
function continueAttempt(r,w) {
  const a=r.attempt, target=w.riders.find(o=>o.id===a.targetId);
  if(!target) return false;
  const gap=target.s-r.s;
  if(gap<a.bestGap-.7){a.bestGap=gap;a.lastProgress=w.time;}
  if(gap < -4) {
    a.outcome='success';r.attempts.push({...a,end:w.time});r.attempt=null;
    r.attackCooldown=w.time+3;
    setState(r,w,w.remaining>430?'CONTROL':'ATTACK','実際に前方ラインを通過',target.d,null);
    return true;
  }
  if(w.time-a.start>4 && (r.energy<16 || w.time-a.lastProgress>5 || w.time-a.start>15)) {
    a.outcome='failed';r.attempts.push({...a,end:w.time});r.attempt=null;r.attackCooldown=w.time+4;
    setState(r,w,'CHASE','外で速度差を作れず追走へ戻す',r.d,w.obstacle?.id??null);
    return true;
  }
  a.stage=Math.abs(r.d-target.d)<.85?'OUTSIDE':gap<3?'ALONGSIDE':gap<12?'APPROACH':'ACCELERATE';
  const p=outerPath(r,w,target);
  setState(r,w,a.kind,`外進路：${a.stage}`,p?.d??r.targetD,null);
  return true;
}
function decideHead(r,w,random) {
  const rivals=w.lineHeads.filter(o=>o.id!==r.id);
  const ahead=rivals.filter(o=>o.s>r.s+1).sort((a,b)=>a.s-b.s)[0];
  const threat=rivals.filter(o=>o.d>r.d+.65 && o.s>r.s-20 && o.s<r.s+3 &&
    (o.v>r.v+.2 || ['MOVE_UP','KAMASHI','MAKURI'].includes(o.action))).sort((a,b)=>b.s-a.s)[0];
  const support=w.lineMembers.filter(o=>o.id!==r.id);
  const tailGap=Math.max(0,...support.map(o=>r.s-o.s));
  const age=w.time-w.releaseTime;
  const path=choosePath(r,w);
  if(r.attempt && continueAttempt(r,w))return;
  if(r.action==='CONTROL' && w.time-r.stateSince<3) {
    setState(r,w,'CONTROL','先頭を抑え、後続の接続を待つ',r.targetD,null);return;
  }
  // Formation is a goal, not a three-column coordinate assignment.
  if(age<11 && tailGap>13) {
    const crowded=w.lineHeads.some(o=>o.id!==r.id && Math.abs(o.d-r.d)<1 && Math.abs(o.s-r.s)<30);
    setState(r,w,'HOLD','自ライン後続の合流を待つ',crowded?path.d:r.targetD,null);return;
  }
  if(threat && !ahead && r.energy>35 && w.remaining>170 && r.action!=='YIELD') {
    if(r.action==='RESIST' && w.time-r.stateSince>4 || random()<.3) {
      setState(r,w,'YIELD','並走の消耗を避けて後ろの位置へ',r.d,threat.id);return;
    }
    setState(r,w,'RESIST','外の上昇へ内から踏んで応答',r.d,null);return;
  }
  if(r.action==='MOVE_UP' && !ahead) {
    setState(r,w,'CONTROL','上昇して先頭へ到達、ペースを落として抑える',
      Math.max(.6,r.d-1.25),null);return;
  }
  if(w.remaining<140) {setState(r,w,'SPRINT','直線の空きと脚残量を使う',path.d,null);return;}
  if(r.energy<25) {
    setState(r,w,'CHASE','脚を使ったため前方の後ろで消耗を抑える',path.d,w.obstacle?.id??ahead?.id??null);return;
  }
  if(ahead) {
    const outside=outerPath(r,w,ahead);
    const gap=ahead.s-r.s;
    const ready=age>8 && w.time>(r.attackCooldown??0) && outside && outside.space>6;
    // Hazard is evaluated now from position, timing and energy, not sampled as a race script.
    const urgency=clamp((730-w.remaining)/500,0,1);
    const opportunity=clamp(.12+urgency*.55+(r.v-ahead.v)*.06+(gap>12?.12:0),.08,.9);
    if(ready && random()<opportunity) {
      const kind=w.remaining>440 && r.v>ahead.v-.8 && r.energy>65 ? 'KAMASHI' : 'MAKURI';
      startAttempt(r,w,kind,ahead,outside);return;
    }
    if(outside && gap>5 && w.remaining>430 && tailGap<38) {
      setState(r,w,'MOVE_UP','後方から空いた外を使い位置を上げる',outside.d,null);return;
    }
    setState(r,w,'HOLD','仕掛けの進路と後続の接続を待つ',r.targetD,ahead.id);return;
  }
  setState(r,w,w.remaining<500?'ATTACK':'CONTROL',w.remaining<500?'主導権を保って踏む':'先頭でペースを管理',r.targetD,null);
}
function decideFollower(r,w,random) {
  const base=w.baseTarget;
  const current=w.riders.find(o=>o.id===r.currentFollowId);
  let target=r.switchedTo?w.riders.find(o=>o.id===r.switchedTo):base;
  const path=choosePath(r,w);
  const gap=target?target.s-r.s:Infinity;
  const age=w.time-w.releaseTime;
  const late=w.remaining<200;
  const clearPass=path.merge && path.space>6 && Math.abs(path.d-r.d)>.8;
  if(late && clearPass && (w.remaining<90 || target && (r.energy>target.energy+12 && w.remaining<160 || target.v<r.v-.25))) {
    setState(r,w,'SPRINT','前の速度・脚残量と空いた進路から交わす',path.d,null);return;
  }
  if(r.action==='SPRINT' && late && (!w.obstacle || w.obstacle.gap>4)) {
    setState(r,w,'SPRINT','ゴールまで自分の進路を伸ばす',path.d,null);return;
  }
  const candidates=w.riders.filter(o=>o.id!==r.id && o.lineId!==r.lineId && o.s>r.s+2 &&
    o.s<r.s+22 && Math.abs(o.d-r.d)<2.2 && o.v>r.v-.8).sort((a,b)=>
    (a.s-r.s+Math.abs(a.d-r.d)*3)-(b.s-r.s+Math.abs(b.d-r.d)*3));
  if(age>10 && r.split && candidates.length && (gap>14 || target?.v<r.v-1 || gap<0) && random()<.7) {
    target=candidates[0];r.switchedTo=target.id;
    setState(r,w,'SWITCH','元ラインの追走が難しく近い他ラインへ切替',target.d,target.id);return;
  }
  // A switched rider may stay with the new wheel; no compulsory return to affiliation.
  if(r.switchedTo && target && target.s>r.s && gap<24) {
    setState(r,w,'SWITCH','切り替えた相手の後ろを維持',target.d,target.id);return;
  }
  if(r.switchedTo && (!target || gap>30 || gap<0)) {r.switchedTo=null;target=base;}
  if(!target){setState(r,w,'CHASE','前方の空きを使い追走を再構築',path.d,current?.id??null);return;}
  if (w.obstacle && w.obstacle.id !== target.id && w.obstacle.gap < 8 && clearPass && age < 25) {
    setState(r,w,'CHASE','自ラインへの合流を塞ぐ車を空いた側から回る',path.d,target.id);return;
  }
  if (gap < 0 && age < 20) {
    setState(r,w,'FOLLOW','前後が逆の所属車を横で待って合流する',path.d,target.id);return;
  }
  if(r.role==='second') {
    const outside=w.riders.find(o=>o.lineId!==r.lineId && o.d>r.d+.6 && o.d<r.d+2.1 &&
      o.s>r.s-7 && o.s<r.s+3 && o.v>r.v+.3);
    if(outside && target.s-r.s<10 && target.s>r.s && w.remaining<550 &&
        w.time>(r.blockCooldown??0) && random()<.55) {
      r.blockCooldown=w.time+4;
      setState(r,w,'BLOCK','外の仕掛けに応じ番手の進路を守る',Math.min(target.d+.6,outside.d-.5),target.id);return;
    }
    if(r.action==='BLOCK' && w.time-r.stateSince<1.2) return;
    if(target.v<r.v-1 && clearPass && w.remaining<350) {
      setState(r,w,'SPRINT','先頭の失速を見て外へ出る',path.d,null);return;
    }
    const chase=target.s-r.s>8 || OFFENSIVE.has(target.action);
    setState(r,w,chase?'CHASE':'FOLLOW',chase?'先頭の加速・開いた車間へ反応':'番手で車間と位置を守る',target.d,target.id);
  } else {
    const chase=target.s-r.s>9;
    setState(r,w,chase?'CHASE':'FOLLOW',chase?'番手との車間を自力で詰める':'3番手で前方の詰まりを見ながら追走',target.d,target.id);
  }
}
export function decide(r,w,random) {
  if(r.role==='leader')decideHead(r,w,random);else decideFollower(r,w,random);
  const obstacle=w.obstacle;
  if(obstacle && obstacle.gap<3.5 && obstacle.v<r.v+.25) {
    const exits=paths(r,w).filter(p=>p.merge && p.space>5 && Math.abs(p.d-r.d)>.9);
    if(!exits.length && r.d<3) {
      setState(r,w,'TRAPPED','前が壁で外へ出る隙間もない',r.d,r.currentFollowId);
    }
  }
}
