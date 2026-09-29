import { TRACK, frame, lane, mod } from './track.mjs';
import { lineController } from './controller.mjs';
import { energyStep, contactCost } from './energy.mjs';
import { createLines, PHASES, phaseAt, LINE_RULES } from './race.mjs';
export const GUIDED_CENTER_GAP = 7.4;
const GUIDED_GAP_TOLERANCE = .01;
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
  constructor(seed = 1, controller = lineController, options = {}) {
    this.seed = seed;
    this.random = rng(seed);
    this.controller = controller;
    this.lines = createLines(options.lines);
    this.phases = options.phases ?? PHASES;
    this.phase = phaseAt(TRACK.finish - TRACK.start, this.phases);
    this.time = 0;
    this.free = false;
    this.contacts = 0; // Side contacts only. Rear constraints never count as impacts.
    this.sideContacts = 0;
    this.result = [];
    this.events = [];
    this.activeContacts = new Set();
    this.contactUntil = new Map();
    this.pacer = { id: 'pacer', s: TRACK.start + GUIDED_CENTER_GAP, d: lane(TRACK.start, 2),
      v: 0, w: 0, state: 'guiding', exitStartedAt: null };
    this.riders = Array.from({ length: 9 }, (_, i) => ({
      id: i + 1, targetLane: i + 1, s: TRACK.start - i * GUIDED_CENTER_GAP, d: lane(TRACK.start, 2),
      v: 0, w: 0, targetD: lane(TRACK.start, 2),
      reactionDelay: .15 + this.random() * 1.6,
      speedOffset: 0, gapOffset: 0, response: 1, desiredGap: 1,
      nextDecision: 0, nextPathDecision: 0, finishTime: null, flash: 0,
      frontId: null, frontGap: null, relativeSpeed: 0,
    }));
    for (const line of this.lines) line.members.forEach((id, order) => {
      const r = this.riders[id - 1];
      Object.assign(r, { lineId: line.id, role: order === 0 ? 'leader' : order === 1 ? 'second' : 'third',
        baseFollowId: order ? line.members[order - 1] : null, currentFollowId: null,
        split: false, splitReason: null, splitFor: 0, joinedFor: 0, cohesion: 1,
        action: order ? 'FOLLOW' : 'HOLD', lastDecision: null, decisionPhase: 'GUIDED',
        energy: 100, energyUsed: 0, sheltered: false, stateSince: 0, reason: '発走待機',
        targetPosition: '誘導員の後ろ', switchedTo: null, attempt: null, attempts: [],
        attackCooldown: 0, blockCooldown: 0 });
      r.currentFollowId = r.baseFollowId;
      r.reactionDelay += order * .65;
      r.nextDecision = r.reactionDelay;
    });
  }
  get done() { return this.result.length === 9; }

  vehicleInfo(rider, other) {
    if (!other) return null;
    const { ds } = separation(rider, other);
    return { id: other.id, distance: ds, gap: ds - BODY.length,
      relativeSpeed: other.v - rider.v, d: other.d, v: other.v };
  }

  // Physical obstacle and affiliated target are intentionally separate observations.
  observe(rider, snapshots) {
    let front = null;
    for (const other of snapshots) {
      if (other.id === rider.id) continue;
      const { ds, dd } = separation(rider, other);
      if (ds <= .015 || ds > 35 || Math.abs(dd) > BODY.width + .08) continue;
      if (!front || ds < front.distance) front = this.vehicleInfo(rider, other);
    }
    return front;
  }

  relationship(rider, snapshots, obstacle) {
    if (rider.role === 'leader') return obstacle;
    const base = snapshots[rider.baseFollowId - 1];
    const info = this.vehicleInfo(rider, base);
    const inserted = snapshots.some(o => o.id !== rider.id && o.lineId !== rider.lineId &&
      o.s > rider.s && o.s < base.s && Math.abs(o.d-rider.d)<BODY.width + .05 && Math.abs(base.d-rider.d)<1.5);
    const reason = info.gap > LINE_RULES.splitGap ? 'gap' : Math.abs(base.d-rider.d)>LINE_RULES.splitD
      ? 'lateral' : inserted ? 'inserted' : info.distance < 0 ? 'target-behind' : null;
    rider.splitFor = reason ? rider.splitFor + DT : 0;
    if (rider.splitFor >= LINE_RULES.splitDelay) { rider.split = true; rider.splitReason = reason; }
    const close = info.distance > 0 && info.gap < LINE_RULES.reconnectGap &&
      Math.abs(base.d-rider.d)<LINE_RULES.reconnectD && !inserted;
    rider.joinedFor = close ? rider.joinedFor + DT : 0;
    if (rider.joinedFor >= LINE_RULES.reconnectDelay) { rider.split = false; rider.splitReason = null; }
    // After a sustained split, temporary shelter is allowed; affiliation is never overwritten.
    // Target changes are explicit tactical decisions, never automatic nearest-wheel swaps.
    return info;
  }

  step() {
    if (this.done) return;
    const prev = this.riders.map(r => r.s);
    const leader = Math.max(...prev);
    this.phase = phaseAt(TRACK.finish - leader, this.phases);
    if (!this.free && leader >= TRACK.finish - 400) {
      this.free = true;
      // Lateral coordinates were already continuous; no simultaneous decision reset.
    }
    if (this.pacer.state === 'guiding' && leader >= TRACK.finish - 800) {
      this.pacer.state = 'exiting';
      this.pacer.exitStartedAt = this.time;
    }
    const snapshots = this.riders.map(r => ({ ...r }));
    const pacerBefore = { ...this.pacer };
    const decisions = this.riders.map(r => {
      const obstacle = this.observe(r, snapshots);
      const beforeAction = r.action;
      const beforeSplit = r.split;
      const guideAhead = r.id === 1 ? this.vehicleInfo(r, pacerBefore) : this.vehicleInfo(r, snapshots[r.id-2]);
      if (pacerBefore.state !== 'guiding') this.relationship(r, snapshots, obstacle);
      const front = pacerBefore.state === 'guiding' ? guideAhead : this.vehicleInfo(r, snapshots.find(o=>o.id===r.currentFollowId));
      r.frontId = front?.id ?? null;
      r.frontGap = front?.gap ?? null;
      r.relativeSpeed = front?.relativeSpeed ?? 0;
      const decision = this.controller(r, {
        time: this.time, free: this.free, pacer: pacerBefore, front, obstacle, phase: this.phase,
        remaining: TRACK.finish - r.s,
        riders: snapshots, releaseTime: this.pacer.exitStartedAt ?? -100, guideAhead,
        guidedCenterGap: GUIDED_CENTER_GAP, curvature: frame(r.s).k,
        distanceTo: other => separation(r, other).ds,
        baseTarget: r.baseFollowId ? snapshots[r.baseFollowId-1] : null,
        lineHeads: this.lines.map(l => snapshots[l.members[0]-1]),
        lineMembers: snapshots.filter(o => o.lineId === r.lineId),
        neighbors: snapshots.filter(o => o.id !== r.id).map(o => ({ id: o.id, d: o.d, v: o.v, ds: separation(r,o).ds })),
        width: frame(r.s).width,
        mergeBlocked: lateral => snapshots.some(other => {
          if (other.id === r.id) return false;
          const { ds, dd } = separation(r, other);
          return Math.abs(ds) > BODY.length * .55 && Math.abs(ds) < BODY.length + .7 &&
            Math.sign(dd) === Math.sign(lateral) && Math.abs(dd) < BODY.width + .3;
        }),
      }, this.random);
      if (r.action !== beforeAction) this.events.push({time:this.time,id:r.id,type:'state',state:r.action,reason:r.reason,s:r.s,energy:r.energy});
      if (r.split !== beforeSplit) this.events.push({time:this.time,id:r.id,type:r.split?'split':'rejoin',reason:r.splitReason});
      return decision;
    });
    for (const line of this.lines) line.split = line.members.some(id => this.riders[id-1].split);
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
      const sheltered = snapshots.some(o=>o.id!==r.id && o.s>snapshots[i].s &&
        o.s-snapshots[i].s<8 && Math.abs(o.d-snapshots[i].d)<.8);
      energyStep(r, {dt:DT, guided:p.state==='guiding', sheltered, curvature:frame(r.s).k,
        acceleration:(r.v-snapshots[i].v)/DT});
    }
    // Retained latest-main guided display-safety constraint, including 7.4m spacing.
    if (p.state === 'guiding') {
      let front = p;
      for (const back of this.riders) {
        const rel=separation(back,front), metric=Math.max(.85,rel.metric);
        const minGap=GUIDED_CENTER_GAP-GUIDED_GAP_TOLERANCE, maxGap=GUIDED_CENTER_GAP+GUIDED_GAP_TOLERANCE;
        if(rel.ds<minGap){back.s=front.s-minGap/metric;back.v=Math.min(back.v,front.v);}
        else if(rel.ds>maxGap){back.s=front.s-maxGap/metric;back.v=Math.max(back.v,front.v);}
        back.d=p.d;back.w=0;back.targetD=p.d;front=back;
      }
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
              contactCost(a,strength); contactCost(b,strength);
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
        if (r.attempt) {
          const target = this.riders[r.attempt.targetId-1];
          const passed = r.s > target.s + 4 && (target.finishTime === null || target.finishTime > r.finishTime);
          r.attempts.push({...r.attempt, outcome:passed?'success':'failed', end:r.finishTime});
          r.attempt = null;
        }
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
