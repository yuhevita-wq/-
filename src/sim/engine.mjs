import {TRACK,frame,lane,mod} from './track.mjs';
import {toyController} from './controller.mjs';
export const DT=1/240;
export const BODY={length:1.9,width:.65};
export function rng(seed) {let a=seed>>>0;return ()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};}
export class Simulation {
 constructor(seed=1,controller=toyController){this.seed=seed;this.random=rng(seed);this.controller=controller;this.time=0;this.free=false;this.contacts=0;this.sideContacts=0;this.result=[];this.activeContacts=new Set();this.riders=Array.from({length:9},(_,i)=>({id:i+1,targetLane:i+1,s:TRACK.start,d:lane(TRACK.start,i+1),v:0,w:0,targetSpeed:13,wander:0,nextDecision:0,finishTime:null,flash:0}));}
 get done(){return this.result.length===9;}
 step(){if(this.done)return;const prev=this.riders.map(r=>r.s);if(!this.free&&Math.max(...prev)>=TRACK.finish-400)this.free=true;
 for(const r of this.riders){const c=this.controller(r,this,this.random);r.v=Math.max(0,Math.min(22,r.v+c.acceleration*DT));const lateral=this.free?c.lateral: (lane(r.s,r.targetLane)-r.d)*3; r.w+=Math.max(-3,Math.min(3,(lateral-r.w)*5))*DT;r.w=Math.max(-1.5,Math.min(1.5,r.w));r.s+=r.v*DT/(1+frame(r.s).k*r.d);r.d+=r.w*DT;r.flash=Math.max(0,r.flash-DT);this.bound(r);}
 const touching=new Set();
 // Iterated nonpenetration constraint in local longitudinal / lateral coordinates.
 for(let iteration=0;iteration<12;iteration++)for(let i=0;i<9;i++)for(let j=i+1;j<9;j++){
 const a=this.riders[i],b=this.riders[j];let ds=mod(b.s-a.s+200)-200;const metric=1+frame((a.s+b.s)/2).k*(a.d+b.d)/2;ds*=metric;const dd=b.d-a.d;const qx=ds/BODY.length,qy=dd/BODY.width;const q=Math.hypot(qx,qy);if(q>=1)continue;
 const key=`${i}:${j}`;touching.add(key);const nx=q>1e-9?qx/q:1,ny=q>1e-9?qy/q:0;const overlap=1-q+1e-7;
 a.s-=nx*overlap*BODY.length/2/metric;b.s+=nx*overlap*BODY.length/2/metric;a.d-=ny*overlap*BODY.width/2;b.d+=ny*overlap*BODY.width/2;
 if(!this.activeContacts.has(key)&&iteration===0){this.contacts++;a.flash=b.flash=.3;const side=Math.abs(ny)>.45;if(side){this.sideContacts++;const kick=.2+this.random()*.65;a.w-=ny*kick;b.w+=ny*kick;a.v*=.93+this.random()*.05;b.v*=.93+this.random()*.05;}else {const front=ds>0?b:a,back=ds>0?a:b;back.v=Math.min(back.v,front.v)*.98;}}
 this.bound(a);this.bound(b);
 }
 this.activeContacts=touching;
 const crossed=[];for(let i=0;i<9;i++){const r=this.riders[i];if(r.finishTime===null&&r.s>=TRACK.finish){r.finishTime=this.time+DT*Math.max(0,Math.min(1,(TRACK.finish-prev[i])/(r.s-prev[i])));crossed.push(r);}}
 crossed.sort((a,b)=>a.finishTime-b.finishTime);this.result.push(...crossed.map(r=>r.id));this.time+=DT;
 }
 bound(r){const lo=BODY.width/2,hi=frame(r.s).width-lo;if(r.d<lo){r.d=lo;r.w=Math.max(0,r.w);}if(r.d>hi){r.d=hi;r.w=Math.min(0,r.w);}}
}
