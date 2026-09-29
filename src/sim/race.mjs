// Race policy data. These are spatial boundaries, never commands broadcast to riders.
export const DEFAULT_LINES = Object.freeze([
  Object.freeze({ id: 'A', members: Object.freeze([1, 5, 7]) }),
  Object.freeze({ id: 'B', members: Object.freeze([3, 8, 4]) }),
  Object.freeze({ id: 'C', members: Object.freeze([2, 6, 9]) }),
]);
export const PHASES = Object.freeze([
  { id: 'GUIDED', remaining: Infinity, label: '誘導追走' },
  { id: 'EXIT', remaining: 800, label: '誘導退避' },
  { id: 'FORM', remaining: 740, label: 'ライン形成' },
  { id: 'POSITION', remaining: 660, label: '位置取り' },
  { id: 'CONTROL', remaining: 600, label: '上昇・抑え' },
  { id: 'CONTEST', remaining: 540, label: '主導権争い' },
  { id: 'ATTACK', remaining: 480, label: '仕掛け' },
  { id: 'FINAL', remaining: 400, label: '最終周' },
  { id: 'BACK', remaining: 200, label: '最終バック' },
  { id: 'STRAIGHT', remaining: 55, label: '直線' },
]);
export const LINE_RULES = Object.freeze({ splitGap: 18, splitD: 2.5, splitDelay: 1.5,
  reconnectGap: 10, reconnectD: 1.2, reconnectDelay: 1 });
export function phaseAt(remaining, phases = PHASES) {
  return phases.reduce((phase, item) => remaining <= item.remaining ? item : phase, phases[0]);
}
export function createLines(config = DEFAULT_LINES) {
  const ids = config.flatMap(l => l.members);
  if (!config.length || new Set(config.map(l => l.id)).size !== config.length ||
      config.some(l => !l.id || !l.members.length) || ids.length !== 9 ||
      new Set(ids).size !== 9 || ids.some(id => !Number.isInteger(id) || id < 1 || id > 9))
    throw new Error('Line configuration must contain each rider 1–9 exactly once and unique line IDs');
  return config.map(l => ({ id: l.id, members: [...l.members], split: false }));
}
