import {Simulation,DT} from './engine.mjs';
import {position,frame,TRACK,L,R} from './track.mjs';
const $=id=>document.getElementById(id),canvas=$('bank'),ctx=canvas.getContext('2d');
const colors=['#fafafa','#24272b','#e74743','#387bdf','#f4d844','#37a362','#ed893c','#ef93bb','#a153c9'];
let sim=new Simulation(seed()),running=false,last=0,acc=0;
function seed(){return crypto.getRandomValues(new Uint32Array(1))[0];}
$('riders').innerHTML=colors.map((c,i)=>`<div class="rider"><span class="badge" style="background:${c};color:${[0,4,7].includes(i)?'#17241c':'white'}">${i+1}</span><span id="speed${i}">0 km/h</span><br/><span id="gap${i}">車間 —</span><br/><span id="line${i}"></span></div>`).join('');
$('start').onclick=()=>{if(!sim.done){running=true;last=performance.now();buttons();}};
$('pause').onclick=()=>{running=false;buttons();};
$('reset').onclick=()=>{sim=new Simulation(seed());running=false;acc=0;buttons();draw();};
function buttons(){$('start').disabled=running||sim.done;$('pause').disabled=!running;}
function draw(){const rect=canvas.getBoundingClientRect(),dpr=devicePixelRatio||1;canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);const w=rect.width,h=rect.height;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
 const zoom=Math.min((w-28)/(L+2*R+27),(h-30)/(2*R+36));const pt=(s,d)=>{const p=position(s,d);return {x:w/2+p.x*zoom,y:h/2+p.y*zoom};};
 const path=d=>{ctx.beginPath();for(let s=0;s<=400;s+=.5){const p=pt(s,typeof d==='function'?d(s):d);s===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);}ctx.closePath();};
 path(s=>frame(s).width);ctx.fillStyle='#7b8587';ctx.fill();
 path(0);ctx.fillStyle='#203f37';ctx.fill();
 path(0);ctx.strokeStyle='#f4f5f2';ctx.lineWidth=3;ctx.stroke();
 path(s=>frame(s).width);ctx.strokeStyle='#f4f5f2';ctx.lineWidth=3;ctx.stroke();
 const innerInset=Math.max(10,Math.min(18,R*.42));
 ctx.beginPath();for(let s=0;s<=400;s+=.5){const p=pt(s,-innerInset);s===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);}ctx.closePath();
 // High-contrast central field so its bank-shaped silhouette is immediately visible.
 ctx.fillStyle='#4f7552';ctx.fill();ctx.strokeStyle='#a8d08d';ctx.lineWidth=3;ctx.stroke();
 for(const [d,col,lw] of [[.7,'#eee3c2',1],[3,'#d1bd61',1.2]]){path(d);ctx.strokeStyle=col;ctx.lineWidth=lw;ctx.stroke();}
 if(!sim.free){ctx.setLineDash([2,5]);for(let i=1;i<9;i++){path(s=>.55+(frame(s).width-1.1)*(i-.5)/8);ctx.strokeStyle='#d4e3de44';ctx.lineWidth=.5;ctx.stroke();}ctx.setLineDash([]);}
 function line(s,color,label){const a=pt(s,0),b=pt(s,frame(s).width);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.strokeStyle=color;ctx.lineWidth=2;ctx.stroke();ctx.font='9px system-ui';ctx.fillStyle=color;ctx.textAlign='center';ctx.fillText(label,b.x,b.y-7);}
 line(0,'#f6eee1','GOAL');line(-25,'#b5e8c5','START');
 ctx.textAlign='center';ctx.fillStyle='#a4b9ac';ctx.font='10px system-ui';ctx.fillText('ホーム ←',w/2,h/2-R*zoom+17);ctx.fillText('バック →',w/2,h/2+R*zoom-12);
 for(const [s,label] of [[80,'1C'],[130,'2C'],[280,'3C'],[330,'4C']]){const p=pt(s,-5);ctx.fillText(label,p.x,p.y);}
 ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`700 ${w<500?20:30}px system-ui`;ctx.fillStyle='#ffffff';ctx.fillText('取手競輪場',w/2,h/2-3);ctx.font='10px system-ui';ctx.fillStyle='#d6ead0';ctx.fillText(sim.free?'FINAL LAP · FREE MOVE':`PHASE ${sim.phase.id} · ${sim.phase.label}`,w/2,h/2+20);ctx.textBaseline='alphabetic';
 {const p=pt(sim.pacer.s,sim.pacer.d);ctx.save();ctx.translate(p.x,p.y);ctx.fillStyle=sim.pacer.state==='retired'?'#61908c':'#7af4e5';ctx.strokeStyle='#123331';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(0,-7);ctx.lineTo(8,0);ctx.lineTo(0,7);ctx.lineTo(-8,0);ctx.closePath();ctx.fill();ctx.stroke();ctx.fillStyle='#092f2b';ctx.font='bold 9px system-ui';ctx.textBaseline='middle';ctx.fillText('誘',0,0);ctx.restore();}
 for(const r of sim.riders){const p=pt(r.s,r.d),f=frame(r.s);ctx.save();ctx.translate(p.x,p.y);ctx.rotate(Math.atan2(f.ty,f.tx));ctx.fillStyle=colors[r.id-1];ctx.strokeStyle=r.flash>0?'#fff3a0':'#101b21';ctx.lineWidth=r.flash>0?2:1;const len=4.2*zoom,wid=1.575*zoom;ctx.beginPath();ctx.roundRect(-len/2,-wid/2,len,wid,3);ctx.fill();ctx.stroke();ctx.restore();ctx.fillStyle=[1,5,8].includes(r.id)?'#14221b':'#fff';ctx.font=`bold ${Math.max(9,Math.min(16,2.25*zoom))}px system-ui`;ctx.textBaseline='middle';ctx.fillText(String(r.id),p.x,p.y);ctx.textBaseline='alphabetic';$('line'+(r.id-1)).textContent=`${r.lineId} · ${({leader:'先頭',second:'番手',third:'3番手'})[r.role]}`;$('gap'+(r.id-1)).textContent=r.frontGap===null?'車間 —':`車間 ${Math.max(0,r.frontGap).toFixed(1)}m`;$('speed'+(r.id-1)).textContent=r.finishTime===null?`${Math.round(r.v*3.6)} km/h`:`${sim.result.indexOf(r.id)+1}着`;}
 for(const top of [true,false]){const group=sim.riders.map(r=>({r,p:pt(r.s,r.d)})).filter(o=>(o.p.y<h/2)===top).sort((a,b)=>a.p.x-b.p.x);let lastX=0;for(const o of group){o.labelX=Math.max(o.p.x,lastX+17,10);lastX=o.labelX;}if(group.length&&lastX>w-10){const shift=lastX-(w-10);for(const o of group)o.labelX-=shift;}for(const o of group){const y=top?12:h-12;ctx.beginPath();ctx.moveTo(o.p.x,o.p.y);ctx.lineTo(o.labelX,y);ctx.strokeStyle=colors[o.r.id-1]+'99';ctx.lineWidth=.7;ctx.stroke();ctx.fillStyle=colors[o.r.id-1];ctx.beginPath();ctx.arc(o.labelX,y,7,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#bdcec2';ctx.stroke();ctx.fillStyle=[1,5,8].includes(o.r.id)?'#14221b':'#fff';ctx.font='bold 10px system-ui';ctx.textBaseline='middle';ctx.fillText(String(o.r.id),o.labelX,y);ctx.textBaseline='alphabetic';}}
 if($('debug').open){$('race-debug').textContent=`Race Phase ${sim.phase.id}：${sim.phase.label} ／ `+sim.lines.map(l=>`${l.id}：${l.members.join('–')}${l.split?'（分断）':''}`).join(' ／ ');$('debug-riders').innerHTML=sim.riders.map(r=>`<tr><td>${r.id}</td><td>${r.lineId}</td><td>${({leader:'先頭',second:'番手',third:'3番手'})[r.role]}</td><td>${r.baseFollowId??'—'}</td><td>${r.currentFollowId==='pacer'?'誘導員':r.currentFollowId??'—'}</td><td>${r.action}${r.cohesion<.85?' / 自由化':''}</td><td>${r.split?r.splitReason:'—'}</td></tr>`).join('');}
 $('phase').textContent=sim.done?'全車ゴール':running?(sim.free?'最終周 · レーン解除':(sim.pacer.state==='guiding'?'誘導追走 · レーン制':sim.pacer.state==='exiting'?'誘導退避中 · レーン制':'走行中 · レーン制')):sim.time?'一時停止':'発走待機';$('remaining').textContent=`${Math.ceil(Math.max(0,TRACK.finish-Math.max(...sim.riders.map(r=>r.s))))} m`;$('time').textContent=sim.time.toFixed(1)+' s';$('pacer').textContent=({guiding:'先導中',exiting:'退避中',retired:'退避済み'})[sim.pacer.state];$('side').textContent=sim.sideContacts;$('result').textContent=sim.result.length?'確定着順：'+sim.result.join(' → '):'着順はゴール通過時に確定します。';
}
function tick(now){if(running){acc+=Math.min((now-last)/1000,.1)*4;while(acc>=DT&&!sim.done){sim.step();acc-=DT;}if(sim.done){running=false;buttons();}}last=now;draw();requestAnimationFrame(tick);}requestAnimationFrame(tick);
