import { TRACK, frame, lane, mod } from './track.mjs';
import { toyController } from './controller.mjs';
export const DT = 1 / 240;
export const BODY = Object.freeze({ length: 1.9, width: .65 });
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6D2B79F5;
    let t = Math.imul(a ^ a >>> 15, a | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
// Signed physical longitudinal separation, including outer-lane distance.
export function separation(a, b) {
  const raw = mod(b.s - a.s + 200) - 200;
  const metric = 1 + frame(a.s + raw / 2).k * (a.d + b.d) / 2;
  return { ds: raw * metric, dd: b.d - a.d, metric };
}

export class Simulation {
  constructor(seed = 1, controller = toyController) {
    this.seed = seed;
    this.random = rng(seed);
    this.controller = controller;
    this.time = 0;
    this.free = false;
    this.contacts = 0; // Side contacts only. Rear constraints never count as impacts.
    this.sideContacts = 0;
    this.result = [];
    this.activeContacts = new Set();
    this.contactUntil = new Map();
    this.pacer = { id: 'pacer', s: TRACK.start + 6, d: lane(TRACK.start, 2),
      v: 0, w: 0, state: 'guiding', exitStartedAt: null };
    this.riders = Array.from({ length: 9 }, (_, i) => ({
      id: i + 1, targetLane: i + 1, s: TRACK.start, d: lane(TRACK.start, i + 1),
      v: 0, w: 0, targetD: lane(TRACK.start, i + 1),
      reactionDelay: .15 + this.random() * 1.6,
      speedOffset: 0, gapOffset: 0, response: 1, desiredGap: 1,
      nextDecision: 0, nextPathDecision: 0, finishTime: null, flash: 0,
      frontId: null, frontGap: null, relativeSpeed: 0,
    }));
  }
  get done() { return this.result.length === 9; }

  observe(rider, snapshots) {
    const paced = this.pacer.state === 'guiding';
    let front = null;
    const vehicles = paced ? [...snapshots, this.pacer] : snapshots;
    for (const other of vehicles) {
      if (other.id === rider.id) continue;
      const { ds, dd } = separation(rider, other);
      // During formation, recognize vehicles ahead across the bank; afterwards
      // follow vehicles in the local corridor. All distances are measured, not assigned.
      if (ds <= .015 || ds > (paced ? 100 : 35)) continue;
      if (!paced && Math.abs(dd) > BODY.width + .3) continue;
      if (!front || ds < front.distance) {
        front = { id: other.id, distance: ds, gap: ds - BODY.length,
          relativeSpeed: other.v - rider.v, d: other.d, v: other.v };
      }
    }
    return front;
  }

  step() {
    if (this.done) return;
    const prev = this.riders.map(r => r.s);
    const leader = Math.max(...prev);
    if (!this.free && leader >= TRACK.finish - 400) {
      this.free = true;
      for (const r of this.riders) { r.targetD = r.d; r.nextPathDecision = this.time; }
    }
    if (this.pacer.state === 'guiding' && leader >= TRACK.finish - 800) {
      this.pacer.state = 'exiting';
      this.pacer.exitStartedAt = this.time;
    }
    const snapshots = this.riders.map(r => ({ ...r }));
    const pacerBefore = { ...this.pacer };
    const decisions = this.riders.map(r => {
      const front = this.observe(r, snapshots);
      r.frontId = front?.id ?? null;
      r.frontGap = front?.gap ?? null;
      r.relativeSpeed = front?.relativeSpeed ?? 0;
      return this.controller(r, {
        time: this.time, free: this.free, pacer: pacerBefore, front,
        width: frame(r.s).width,
        mergeBlocked: lateral => snapshots.some(other => {
          if (other.id === r.id) return false;
          const { ds, dd } = separation(r, other);
          return Math.abs(ds) > BODY.length * .55 && Math.abs(ds) < BODY.length + .7 &&
            Math.sign(dd) === Math.sign(lateral) && Math.abs(dd) < BODY.width + .3;
        }),
      }, this.random);
    });
    const p = this.pacer;
    if (p.state === 'guiding') {
      p.v = Math.min(11.5, p.v + 1.2 * DT);
      p.d = lane(p.s, 2);
    } else if (p.state === 'exiting') {
      p.d -= 1.2 * DT;
      p.v = Math.max(3, p.v - 1.2 * DT);
      if (p.d <= -4) { p.d = -4; p.state = 'retired'; p.v = 0; }
    }
    if (p.state !== 'retired') p.s += p.v * DT / (1 + frame(p.s).k * Math.max(0, p.d));

    for (let i = 0; i < 9; i++) {
      const r = this.riders[i], c = decisions[i];
      r.v = clamp(r.v + clamp(c.acceleration, -5, 2.4) * DT, 0, 22);
      r.w += clamp((c.lateral - r.w) * 4, -2, 2) * DT;
      r.w = clamp(r.w, -1.2, 1.2);
      r.s += r.v * DT / (1 + frame(r.s).k * r.d);
      r.d += r.w * DT;
      r.flash = Math.max(0, r.flash - DT);
      this.bound(r);
    }
    // A predictive rear safety constraint limits ONLY the following vehicle.
    // It is not an impact: no restitution, kick, random penalty, or pushing the front.
    const touching = new Set();
    for (let iteration = 0; iteration < 18; iteration++) {
      let changed = false;
      for (let i = 0; i < 9; i++) {
        const a = this.riders[i];
        // The guiding pacer cannot be passed, even from another lane.
        if (p.state === 'guiding' || (p.state === 'exiting' && p.d > -.3)) {
          if ((p.state === 'guiding' || Math.abs(a.d - p.d) < BODY.width) &&
              a.s > p.s - BODY.length - .2) {
            a.s = p.s - BODY.length - .2;
            a.v = Math.min(a.v, p.v);
            changed = true;
          }
        }
        for (let j = i + 1; j < 9; j++) {
          const b = this.riders[j];
          const { ds, dd, metric } = separation(a, b);
          if (Math.abs(ds) >= BODY.length || Math.abs(dd) >= BODY.width) continue;
          const was = separation(snapshots[i], snapshots[j]);
          // Rear closing (including swept crossing of s) is always a speed/gap constraint.
          const rear = Math.abs(was.ds) >= BODY.length * .55 || (Math.abs(was.dd) < BODY.width * .35 && Math.abs(was.ds) > .1);
          if (rear) {
            const front = was.ds >= 0 ? b : a, back = front === b ? a : b;
            const gap = BODY.length / metric + 1e-6;
            const forwardDistance = mod(front.s - back.s + 200) - 200;
            const previousBack = snapshots[back.id - 1];
            const limit = back.s + forwardDistance - gap;
            if (limit < previousBack.s && Math.abs(was.dd) >= BODY.width) {
              // A rear-wheel merge is blocked laterally before overlap, never by
              // throwing the following rider backwards along the track.
              const sign = dd >= 0 ? 1 : -1;
              const overlap = BODY.width - Math.abs(dd) + 1e-6;
              a.d -= sign * overlap / 2; b.d += sign * overlap / 2;
              a.w = 0; b.w = 0;
              this.bound(a); this.bound(b);
            } else {
              back.s = limit;
              back.v = Math.min(back.v, front.v);
            }
          } else {
            // Only the lateral coordinate is separated. Longitudinal positions aren't bounced.
            const sign = dd >= 0 ? 1 : -1;
            const overlap = BODY.width - Math.abs(dd) + 1e-6;
            a.d -= sign * overlap / 2;
            b.d += sign * overlap / 2;
            const key = `${i}:${j}`;
            touching.add(key);
            if (iteration === 0 && (this.contactUntil.get(key) ?? -1) <= this.time) {
              this.contactUntil.set(key, this.time + .35);
              this.contacts++; this.sideContacts++;
              a.flash = b.flash = .3;
              const strength = clamp(Math.abs(a.w - b.w) + .1, .1, 1.5);
              const kick = strength * (.2 + this.random() * .4);
              a.w -= sign * kick; b.w += sign * kick;
              a.v *= 1 - strength * (.015 + this.random() * .025);
              b.v *= 1 - strength * (.015 + this.random() * .025);
              // Recovery target produces a short-lived course adjustment as well as a kick.
              a.targetD = clamp(a.d - sign * .2, .55, frame(a.s).width - .55);
              b.targetD = clamp(b.d + sign * .2, .55, frame(b.s).width - .55);
            }
            this.bound(a); this.bound(b);
          }
          changed = true;
        }
      }
      if (!changed) break;
    }
    this.activeContacts = touching;
    const crossed = [];
    for (let i = 0; i < 9; i++) {
      const r = this.riders[i];
      if (r.finishTime === null && r.s >= TRACK.finish) {
        r.finishTime = this.time + DT * clamp((TRACK.finish - prev[i]) / (r.s - prev[i]), 0, 1);
        crossed.push(r);
      }
    }
    crossed.sort((a, b) => a.finishTime - b.finishTime);
    this.result.push(...crossed.map(r => r.id));
    this.time += DT;
  }

  bound(r) {
    const lo = BODY.width / 2, hi = frame(r.s).width - lo;
    if (r.d < lo) { r.d = lo; r.w = Math.max(0, r.w); }
    if (r.d > hi) { r.d = hi; r.w = Math.min(0, r.w); }
  }
}
