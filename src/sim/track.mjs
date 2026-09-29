// Toride official guide inner edge: straight 284.8 SVG units, radius 95.75.
// Uniform scaling preserves the guide's aspect ratio; not a survey reconstruction.
const scale = 400 / (2 * 284.8 + 2 * Math.PI * 95.75);
export const L = 284.8 * scale, R = 95.75 * scale;
export const TRACK = Object.freeze({length:400,homeWidth:10,centerWidth:7.5,start:-25,finish:2000});
export const mod = (s) => ((s % 400) + 400) % 400;
// The former green infield band is now part of the rideable surface.
// Keep the yellow central island untouched and expose this inset to physics/rendering.
export const INNER_INSET = Math.max(10, Math.min(18, R * .42));
// s=0 at official diagram's finish, 24.95 diagram units left of straight midpoint.
const finishOffset = 24.95 * scale;
export function frame(s) {
  let u = mod(s + L/2 + finishOffset), x,y,tx,ty,k=0;
  if (u<L) { x=L/2-u; y=-R; tx=-1;ty=0; }
  else if ((u-=L)<Math.PI*R) { const a=-Math.PI/2-u/R; x=-L/2+R*Math.cos(a);y=R*Math.sin(a);tx=Math.sin(a);ty=-Math.cos(a);k=1/R; }
  else if ((u-=Math.PI*R)<L) { x=-L/2+u;y=R;tx=1;ty=0; }
  else {u-=L;const a=Math.PI/2-u/R;x=L/2+R*Math.cos(a);y=R*Math.sin(a);tx=Math.sin(a);ty=-Math.cos(a);k=1/R;}
  const bend=Math.max(0,(Math.abs(x)-L/2)/R);
  const width=10-2.5*bend*bend;
  return {x,y,tx,ty,nx:-ty,ny:tx,k,width,minD:-INNER_INSET,maxD:width,rideWidth:width+INNER_INSET};
}
export function position(s,d) {const f=frame(s);return {x:f.x+f.nx*d,y:f.y+f.ny*d};}
// Formation lanes now span the whole rideable band, from the yellow island to the outer edge.
export function lane(s,id) {const f=frame(s);return f.minD+.55+(f.rideWidth-1.1)*(id-1)/8;}
