// Toride official guide inner edge: straight 284.8 SVG units, radius 95.75.
// Uniform scaling preserves the guide's aspect ratio; not a survey reconstruction.
const scale = 400 / (2 * 284.8 + 2 * Math.PI * 95.75);
export const L = 284.8 * scale, R = 95.75 * scale;
export const TRACK = Object.freeze({length:400,homeWidth:10,centerWidth:7.5,start:-25,finish:2000});
export const mod = (s) => ((s % 400) + 400) % 400;
// Everything that used to be green between the old inner edge and the yellow island
// is now part of the rideable bank. Coordinates remain 0..width so the existing
// controller/collision code automatically gains the extra room.
export const INNER_INSET = Math.max(10, Math.min(18, R * .42));
const finishOffset = 24.95 * scale;
export function frame(s) {
  let u = mod(s + L/2 + finishOffset), x,y,tx,ty,k=0;
  if (u<L) { x=L/2-u; y=-R; tx=-1;ty=0; }
  else if ((u-=L)<Math.PI*R) { const a=-Math.PI/2-u/R; x=-L/2+R*Math.cos(a);y=R*Math.sin(a);tx=Math.sin(a);ty=-Math.cos(a);k=1/R; }
  else if ((u-=Math.PI*R)<L) { x=-L/2+u;y=R;tx=1;ty=0; }
  else {u-=L;const a=Math.PI/2-u/R;x=L/2+R*Math.cos(a);y=R*Math.sin(a);tx=Math.sin(a);ty=-Math.cos(a);k=1/R;}
  const bend=Math.max(0,(Math.abs(x)-L/2)/R);
  const originalWidth=10-2.5*bend*bend;
  const width=originalWidth+INNER_INSET;
  return {x,y,tx,ty,nx:-ty,ny:tx,k,width,originalWidth,oldInnerD:INNER_INSET};
}
// d=0 is now the yellow-island edge; d=INNER_INSET is the former inner edge.
export function position(s,d) {const f=frame(s);const physicalD=d-INNER_INSET;return {x:f.x+f.nx*physicalD,y:f.y+f.ny*physicalD};}
export function lane(s,id) {return .55+(frame(s).width-1.1)*(id-1)/8;}
