import {Simulation,DT} from './engine.mjs';
import {position,frame,TRACK,L,R} from './track.mjs';
const $=id=>document.getElementById(id),canvas=$('bank'),ctx=canvas.getContext('2d');
const colors=['#fafafa','#24272b','#e74743','#387bdf','#f4d844','#37a362','#ed893c','#ef93bb','#a153c9'];
let sim=new Simulation(seed()),running=false,last=0,acc=0;
function seed(){return crypto.getRandomValues(new Uint32Array(1))[0];}
$('riders').innerHTML=colors.map((c,i)=>`<div class="rider"><span class="badge" style="background:${c};color:${[0,4,7].includes(i)?'#17241c':'white'}">${i+1}</span><span id="speed${i}">0 km/h</span><br/><span id="gap${i}">車間 —</span></div>`).join('');
$('start').onclick=()=>{if(!sim.done){running=true;last=performance.now();buttons();}};
$('pause').onclick=()=>{running=false;buttons();};
$('reset').onclick=()=>{sim=new Simulation(seed());running=false;acc=0;buttons();draw();};
function buttons(){$('start').disabled=running||sim.done;$('pause').disabled=!running;}
function draw(){const rect=canvas.getBoundingClientRect(),dpr=devicePixelRatio||1;canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);const w=rect.width,h=rect.height;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
 const zoom=Math.min((w-28)/(L+2*R+27),(h-30)/(2*R+36));const pt=(s,d)=>{const p=position(s,d);return {x:w/2+p.x*zoom,y:h/2+p.y*zoom};};
 const path=d=>{ctx.beginPath();for(let s=0;s<=400;s+=.5){const p=pt(s,typeof d==='function'?d(s):d);s===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y);}ctx.closePath();};
 path(s=>frame(s).width);ctx.fillStyle='#69827d';ctx.fill();path(0);ctx.fillStyle='#203f37';ctx.fill();
 for(const [d,col,lw] of [[0,'#f4efe0',1],[.7,'#eee3c2',.6],[3,'#d1bd61',.8]]){path(d);ctx.strokeStyle=col;ctx.lineWidth=lw;ctx.stroke();}
 if(!sim.free){ctx.setLineDash([2,5]);for(let i=1;i<9;i++){path(s=>.55+(frame(s).width-1.1)*(i-.5)/8);ctx.strokeStyle='#d4e3de44';ctx.lineWidth=.5;ctx.stroke();}ctx.setLineDash([]);}
 function line(s,color,label){const a=pt(s,0),b=pt(s,frame(s).width);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.strokeStyle=color;ctx.lineWidth=2;ctx.stroke();ctx.font='9px system-ui';ctx.fillStyle=color;ctx.textAlign='center';ctx.fillText(label,b.x,b.y-7);}
 line(0,'#f6eee1','GOAL');line(-25,'#b5e8c5','START');
 ctx.textAlign='center';ctx.fillStyle='#a4b9ac';ctx.font='10px system-ui';ctx.fillText('ホーム ←',w/2,h/2-R*zoom+17);ctx.fillText('バック →',w/2,h/2+R*zoom-12);
 for(const [s,label] of [[80,'1C'],[130,'2C'],[280,'3C'],[330,'4C']]){const p=pt(s,-5);ctx.fillText(label,p.x,p.y);}
 ctx.font=`600 ${w<500?16:24}px system-ui`;ctx.fillStyle='#c9d8bb';ctx.fillText('TORIDE',w/2,h/2-3);ctx.font='10px system-ui';ctx.fillStyle='#88a397';ctx.fillText(sim.free?'FINAL LAP · FREE MOVE':'400m · LANE MODE',w/2,h/2+16);
 // A separate cyan diamond identifies the pacer; retired pacer remains parked infield.
 {const p=pt(sim.pacer.s,sim.pacer.d);ctx.save();ctx.translate(p.x,p.y);ctx.fillStyle=sim.pacer.state==='retired'?'#61908c':'#7af4e5';ctx.strokeStyle='#123331';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(0,-7);ctx.lineTo(8,0);ctx.lineTo(0,7);ctx.lineTo(-8,0);ctx.closePath();ctx.fill();ctx.stroke();ctx.fillStyle='#092f2b';ctx.font='bold 9px system-ui';ctx.textBaseline='middle';ctx.fillText('誘',0,0);ctx.restore();}
 // Display exaggeration is independent of the 1.9m × .65m physics body.
 for(const r of sim.riders){const p=pt(r.s,r.d),f=frame(r.s);ctx.save();ctx.translate(p.x,p.y);ctx.rotate(Math.atan2(f.ty,f.tx));ctx.fillStyle=colors[r.id-1];ctx.strokeStyle=r.flash>0?'#fff3a0':'#101b21';ctx.lineWidth=r.flash>0?2:1;const len=2.8*zoom,wid=1.05*zoom;ctx.beginPath();ctx.roundRect(-len/2,-wid/2,len,wid,2);ctx.fill();ctx.stroke();ctx.restore();ctx.fillStyle=[1,5,8].includes(r.id)?'#14221b':'#fff';ctx.font=`bold ${Math.max(7,Math.min(12,1.5*zoom))}px system-ui`;ctx.textBaseline='middle';ctx.fillText(String(r.id),p.x,p.y);ctx.textBaseline='alphabetic';$('gap'+(r.id-1)).textContent=r.frontGap===null?'車間 —':`車間 ${Math.max(0,r.frontGap).toFixed(1)}m`;$('speed'+(r.id-1)).textContent=r.finishTime===null?`${Math.round(r.v*3.6)} km/h`:`${sim.result.indexOf(r.id)+1}着`;}

 // Separated number labels keep every rider identifiable even in a tight pack.
 for(const top of [true,false]){const group=sim.riders.map(r=>({r,p:pt(r.s,r.d)})).filter(o=>(o.p.y<h/2)===top).sort((a,b)=>a.p.x-b.p.x);let lastX=0;for(const o of group){o.labelX=Math.max(o.p.x,lastX+17,10);lastX=o.labelX;}if(group.length&&lastX>w-10){const shift=lastX-(w-10);for(const o of group)o.labelX-=shift;}for(const o of group){const y=top?12:h-12;ctx.beginPath();ctx.moveTo(o.p.x,o.p.y);ctx.lineTo(o.labelX,y);ctx.strokeStyle=colors[o.r.id-1]+'99';ctx.lineWidth=.7;ctx.stroke();ctx.fillStyle=colors[o.r.id-1];ctx.beginPath();ctx.arc(o.labelX,y,7,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#bdcec2';ctx.stroke();ctx.fillStyle=[1,5,8].includes(o.r.id)?'#14221b':'#fff';ctx.font='bold 10px system-ui';ctx.textBaseline='middle';ctx.fillText(String(o.r.id),o.labelX,y);ctx.textBaseline='alphabetic';}}
 $('phase').textContent=sim.done?'全車ゴール':running?(sim.free?'最終周 · レーン解除':(sim.pacer.state==='guiding'?'誘導追走 · レーン制':sim.pacer.state==='exiting'?'誘導退避中 · レーン制':'走行中 · レーン制')):sim.time?'一時停止':'発走待機';$('remaining').textContent=`${Math.ceil(Math.max(0,TRACK.finish-Math.max(...sim.riders.map(r=>r.s))))} m`;$('time').textContent=sim.time.toFixed(1)+' s';$('pacer').textContent=({guiding:'先導中',exiting:'退避中',retired:'退避済み'})[sim.pacer.state];$('side').textContent=sim.sideContacts;$('result').textContent=sim.result.length?'確定着順：'+sim.result.join(' → '):'着順はゴール通過時に確定します。';
}
function tick(now){if(running){acc+=Math.min((now-last)/1000,.1)*4;while(acc>=DT&&!sim.done){sim.step();acc-=DT;}if(sim.done){running=false;buttons();}}last=now;draw();requestAnimationFrame(tick);}requestAnimationFrame(tick);
