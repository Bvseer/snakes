// Neon snakes: the whole game in one place. The server runs it for rooms, the phone runs it for solo play,
// and phones use addHead() to rebuild every body from the heads the server sends, so bodies cost nothing on the wire.

export const TICK = 1/20, ROUND = 120, R0 = 48, RMIN = 18, SHRINK = 50;   // seconds, units
export const SEG = 0.5, V = 7, VB = 13, TURN = 3.6, L0 = 18, LMIN = 10, MAXS = 6;
export const COLORS = [0x00f0ff, 0xff2bd6, 0x7cff3a, 0xffb020, 0x9b6bff, 0xff4040, 0x30ffb0, 0xfff04a];
const BOTS = ['Кобра', 'Питон', 'Мамба', 'Гадюка', 'Анаконда', 'Удав', 'Тайпан', 'Уж'];

export const radius = (L) => 0.62 + Math.min(0.6, L/450);
export const arenaR = (tm) => tm < SHRINK ? R0 : Math.max(RMIN, R0 - (R0 - RMIN)*(tm - SHRINK)/(ROUND - SHRINK - 10));
const q = (v) => Math.round(v*100)/100;
const wrap = (a) => { while (a > Math.PI) a -= 2*Math.PI; while (a < -Math.PI) a += 2*Math.PI; return a; };

// seeded random so a solo round and its replay agree; the server seeds from the clock
export function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s/4294967296; }; }

export function newGame(seed) {
  return { tm: -3, ph: 'play', R: R0, rnd: rng(seed || Date.now()), sn: [], food: [], fid: 1, ev: [], fa: [], fr: [], deaths: 0, humans: 0 };
}

// the body: points SEG apart behind the head. Same inputs give the same points on every machine.
export function addHead(s, x, z) {
  const t = s.tr; s.x = x; s.z = z;
  if (!t.length) { t.push([x, z]); return; }
  for (let n = 0; n < 8; n++) {
    const p = t[0], dx = x - p[0], dz = z - p[1], d = Math.hypot(dx, dz); if (d < SEG) break;
    t.unshift([q(p[0] + dx/d*SEG), q(p[1] + dz/d*SEG)]); s.n = (s.n || 0) + 1;   // n: points ever laid, so stripes can stay put on the body
  }
  const keep = Math.max(2, Math.ceil(s.L)); if (t.length > keep) t.length = keep;
}

export function addSnake(S, id, name, bot) {
  if (S.sn.length >= MAXS) return null;
  const i = S.sn.length, ang = i/MAXS*Math.PI*2 + 0.3, r = R0*0.62;
  const x = q(Math.cos(ang)*r), z = q(Math.sin(ang)*r), a = wrap(ang + Math.PI/2);   // everyone starts on a ring, going round it
  const s = { i, id: String(id), name: String(name).slice(0, 16), bot: !!bot, col: i, x, z, a, ta: a, boost: false, L: L0, tr: [], alive: true, kills: 0, place: 0, dropT: 0, best: L0,
    ai: bot ? { skill: 0.8 + S.rnd()*0.2, goal: null, think: 0, hunt: 0, v: 2 } : null };
  // a short straight tail behind the start point
  for (let k = Math.ceil(L0); k >= 0; k--) addHead(s, q(x - Math.cos(a)*k*SEG), q(z - Math.sin(a)*k*SEG));
  if (!bot) S.humans++; S.sn.push(s); return s;
}
export function fillBots(S) { let k = 0; const from = Math.floor(S.rnd()*8); while (S.sn.length < MAXS) { addSnake(S, 'bot' + k, BOTS[(from + k) % 8], true); k++; } }
// two ways to steer: a heading to turn toward (finger), or "keep turning this way while the key is held" (keys)
export function input(S, id, c) { const s = S.sn.find((v) => v.id === String(id)); if (!s || !s.alive || !c) return;
  if (c.r === -1 || c.r === 0 || c.r === 1) { s.turn = c.r; if (!c.r) s.ta = s.a; } else if (Number.isFinite(c.a)) { s.turn = 0; s.ta = wrap(c.a); }
  s.boost = !!c.b; }
export function removeHuman(S, id) { const s = S.sn.find((v) => v.id === String(id)); if (s && s.alive) die(S, s, null); }

function food(S, x, z, v, corpse) { const f = [S.fid++, q(x), q(z), v, corpse ? S.tm : -1]; S.food.push(f); S.fa.push(f); return f; }
function topUpFood(S) {
  const want = 70 + 22*S.sn.filter((s) => s.alive).length;
  for (let n = 0; S.food.length < want && n < 12; n++) { const r = Math.sqrt(S.rnd())*(S.R - 3), a = S.rnd()*Math.PI*2; food(S, Math.cos(a)*r, Math.sin(a)*r, S.rnd() < 0.1 ? 2 : 0.7); }
}

function die(S, s, by) {
  s.alive = false; s.boost = false; s.place = S.sn.filter((v) => v.alive).length + 1; S.deaths++;
  if (by && by !== s) by.kills++;
  // the body turns into food: whoever is near gets fat
  for (let k = 0; k < s.tr.length; k += 2) { const p = s.tr[k]; if (Math.hypot(p[0], p[1]) < S.R - 1) food(S, p[0] + (S.rnd() - 0.5)*0.8, p[1] + (S.rnd() - 0.5)*0.8, 1.2, true); }
  S.ev.push({ t: 'die', i: s.i, by: by && by !== s ? by.i : -1, x: s.x, z: s.z });
}

// ---- the strong bot -----------------------------------------------------------
// It tries a fan of headings, flies each one forward with its real turning circle for a second or so,
// against every body on the field and every head where it will be by then, and takes the safest one
// that still goes where it wants. It goes for thick patches of food, races to fresh remains,
// cuts across the path of snakes it can outrun, and keeps off the wall when the arena closes in.
const FAN = [0, 0.25, -0.25, 0.5, -0.5, 0.8, -0.8, 1.15, -1.15, 1.6, -1.6, 2.2, -2.2, 3.0];
function pickGoal(S, s, A) {
  const sight = 22 + A.skill*12; A.boostWant = false; A.prey = null;
  // 1. remains of a snake that just died
  let best = null, cd = 1e9;
  for (const f of S.food) { if (!(f[4] >= 0 && S.tm - f[4] < 8)) continue; const dx = f[1] - s.x, dz = f[2] - s.z, d2 = dx*dx + dz*dz; if (d2 < sight*sight && d2 < cd) { cd = d2; best = [f[1], f[2]]; } }
  if (best) { A.goal = best; A.boostWant = cd > 30; return; }
  // 2. someone to cut off: get to a point ahead of their head before they do, then cross it
  if (s.L > LMIN + 8 && S.rnd() < 0.35 + A.skill*0.45) {
    let pick = null, ps = 0;
    for (const o of S.sn) { if (o === s || !o.alive) continue; const dx = o.x - s.x, dz = o.z - s.z, d = Math.hypot(dx, dz); if (d > 18 || d < 2) continue;
      const lead = 3 + d*0.45, px = o.x + Math.cos(o.a)*lead, pz = o.z + Math.sin(o.a)*lead; if (Math.hypot(px, pz) > S.R - 3) continue;
      const mine = Math.hypot(px - s.x, pz - s.z)/VB, theirs = lead/V; if (mine > theirs*0.85) continue;
      const sc = (o.bot ? 1 : 1.6)*(1 + o.L/60)/(d + 4); if (sc > ps) { ps = sc; pick = [px + Math.cos(o.a)*1.5, pz + Math.sin(o.a)*1.5]; } }
    if (pick) { A.goal = pick; A.boostWant = true; A.prey = true; return; }
  }
  // 3. the thickest patch of food within reach
  const cells = new Map(), C = 4;
  for (const f of S.food) { const dx = f[1] - s.x, dz = f[2] - s.z; if (dx*dx + dz*dz > 900) continue; const key = Math.floor(f[1]/C)*1000 + Math.floor(f[2]/C); const c = cells.get(key); if (c) { c[0] += f[3]; c[1] += f[1]*f[3]; c[2] += f[2]*f[3]; } else cells.set(key, [f[3], f[1]*f[3], f[2]*f[3]]); }
  let bs = -1; for (const c of cells.values()) { const x = c[1]/c[0], z = c[2]/c[0], d = Math.hypot(x - s.x, z - s.z), ahead = Math.cos(Math.atan2(z - s.z, x - s.x) - s.a);
    const sc = c[0]/(d + 5)*(1.15 + 0.35*ahead)*(Math.hypot(x, z) > S.R - 4 ? 0.2 : 1); if (sc > bs) { bs = sc; best = [x, z]; } }
  // 4. the wall is closing in: stay towards the middle
  if (S.tm > SHRINK - 5 && Math.hypot(s.x, s.z) > S.R*0.65) best = [s.x*0.3, s.z*0.3];
  A.goal = best || [-s.x*0.3, -s.z*0.3];
}
function think2(S, s, g) {
  const A = s.ai, r = radius(s.L), H = 0.8 + A.skill*0.6, closing = S.tm > SHRINK - 3;
  A.think -= TICK; if (A.think <= 0 || !A.goal) { A.think = 0.15 + S.rnd()*0.1; pickGoal(S, s, A); }
  const heads = []; for (const o of S.sn) if (o !== s && o.alive && Math.abs(o.x - s.x) < 26 && Math.abs(o.z - s.z) < 26) heads.push(o);
  const fly = (ta, boost) => { let x = s.x, z = s.z, a = s.a; const v = boost ? VB : V, dt = 0.1, tr = TURN*(boost ? 0.8 : 1)*dt, wall = S.R - r - 0.7 - (closing ? 2 : 0);
    for (let k = 1, t = dt; t <= H + 1e-9; k++, t += dt) { const d = wrap(ta - a); a += Math.max(-tr, Math.min(tr, d)); x += Math.cos(a)*v*dt; z += Math.sin(a)*v*dt;
      if (x*x + z*z > wall*wall) return t; if (hit(g, x, z, r + 0.3, s, true)) return t;
      for (const o of heads) { const px = o.x + Math.cos(o.a)*V*t, pz = o.z + Math.sin(o.a)*V*t, rr = r + radius(o.L) + 0.7; if ((px - x)*(px - x) + (pz - z)*(pz - z) < rr*rr) return t; } }
    return Infinity; };
  const want = Math.atan2(A.goal[1] - s.z, A.goal[0] - s.x);
  let pick = want, low = 1e9, pickT = Infinity;
  const tryA = (ta) => { const T = fly(ta, false), cost = (T === Infinity ? 0 : (H + 0.2 - T)*80) + Math.abs(wrap(ta - want))*1.2 + Math.abs(wrap(ta - s.a))*0.15; if (cost < low) { low = cost; pick = ta; pickT = T; } };
  tryA(want); for (const off of FAN) tryA(wrap(s.a + off));
  s.ta = wrap(pick);
  // dash: to cut someone off or reach remains, or to get out of a closing trap, but only if the dash itself is safe
  const canDash = s.L > LMIN + 5;
  s.boost = canDash && ((A.boostWant && Math.abs(wrap(pick - want)) < 0.45) || pickT < H*0.6) && fly(pick, true) === Infinity;
}

// every body point, by cell, for collisions and for bots looking where they go
const CELL = 3, HIT = { k: 0 };
function grid(S) {
  const g = new Map();
  for (const s of S.sn) { if (!s.alive) continue; const r = radius(s.L);
    for (let k = 0; k < s.tr.length; k++) { const p = s.tr[k], key = Math.floor(p[0]/CELL)*1000 + Math.floor(p[1]/CELL); let c = g.get(key); if (!c) g.set(key, c = []); c.push(s, p[0], p[1], r, k); } }
  return g;
}
function hit(g, x, z, r, me, skipOwn) {
  const cx = Math.floor(x/CELL), cz = Math.floor(z/CELL);
  for (let i = cx - 1; i <= cx + 1; i++) for (let j = cz - 1; j <= cz + 1; j++) { const c = g.get(i*1000 + j); if (!c) continue;
    for (let n = 0; n < c.length; n += 5) { const o = c[n]; if (o === me) continue; const dx = c[n + 1] - x, dz = c[n + 2] - z, rr = c[n + 3] + r; if (dx*dx + dz*dz < rr*rr*0.8) { HIT.k = c[n + 4]; return o; } } }
  return null;
}

// the first, weaker bot: kept only to measure the strong one against (test/bots.test.mjs)
function think(S, s, g) {
  const A = s.ai; A.think -= TICK; const r = radius(s.L);
  // where would each heading take me in the next couple of seconds?
  const danger = (a) => { let d = 0;
    for (let k = 1; k <= 5; k++) { const dist = k*1.6*(0.6 + A.skill*0.6), x = s.x + Math.cos(a)*dist, z = s.z + Math.sin(a)*dist;
      if (Math.hypot(x, z) > S.R - r - 1) { d += 6 - k; continue; } if (hit(g, x, z, r + 0.4, s, true)) d += 6 - k; } return d; };
  if (A.think <= 0) { A.think = 0.25 + S.rnd()*0.2;
    // something tasty nearby, or a smaller snake to cut off
    // what's left of a snake that just died is worth a dash from much further away
    let best = null, bs = -1, feast = false, cd = 1e9; const sight = 18 + A.skill*14;
    for (const f of S.food) { const dx = f[1] - s.x, dz = f[2] - s.z, d2 = dx*dx + dz*dz;
      if (f[4] >= 0 && S.tm - f[4] < 8 && d2 < sight*sight) { if (d2 < cd) { cd = d2; best = [f[1], f[2]]; feast = d2 > 25; } continue; }
      if (cd < 1e9 || d2 > 400) continue; const sc = f[3]/(d2 + 4); if (sc > bs) { bs = sc; best = [f[1], f[2]]; } }
    A.hunt = 0; A.feast = feast;
    if (!feast && S.rnd() < A.skill*0.5) for (const o of S.sn) { if (o === s || !o.alive || o.L > s.L*1.3) continue; const d = Math.hypot(o.x - s.x, o.z - s.z); if (d < 12) { best = [o.x + Math.cos(o.a)*4, o.z + Math.sin(o.a)*4]; A.hunt = 1; break; } }
    A.goal = best || [-s.x*0.3, -s.z*0.3];
  }
  const want = Math.atan2(A.goal[1] - s.z, A.goal[0] - s.x);
  let pick = want, low = 1e9;
  for (const off of [0, 0.4, -0.4, 0.9, -0.9, 1.5, -1.5, 2.2, -2.2]) { const a = s.a + off, d = danger(a), cost = d*10 + Math.abs(wrap(a - want))*(1.2 - A.skill*0.5); if (cost < low) { low = cost; pick = a; } }
  s.ta = wrap(pick); s.boost = ((A.hunt || A.feast) && s.L > LMIN + 5 && danger(s.a) === 0 && Math.abs(wrap(pick - want)) < 0.5) || (low >= 10 && s.L > LMIN + 2 && S.rnd() < A.skill*0.3);
}

export function step(S) {
  S.ev = []; S.fa = []; S.fr = [];
  if (S.ph !== 'play') return;
  S.tm = q(S.tm + TICK); if (S.tm <= 0) return;   // three seconds to look around before anyone moves
  S.R = q(arenaR(S.tm));
  let g = grid(S);
  for (const s of S.sn) if (s.alive && s.bot) (s.ai.v === 1 ? think : think2)(S, s, g);
  // move: turn toward where the finger points, then straight ahead for one tick
  for (const s of S.sn) { if (!s.alive) continue;
    const boost = s.boost && s.L > LMIN, turn = TURN*(boost ? 0.8 : 1)*TICK;
    if (s.turn) { s.a = wrap(s.a + s.turn*turn); s.ta = s.a; }
    else { const d = wrap(s.ta - s.a); s.a = wrap(s.a + Math.max(-turn, Math.min(turn, d))); }
    const v = (boost ? VB : V)*TICK; addHead(s, q(s.x + Math.cos(s.a)*v), q(s.z + Math.sin(s.a)*v));
    if (boost) { s.L = q(s.L - 1.6*TICK); s.dropT += TICK; if (s.dropT > 0.35) { s.dropT = 0; const p = s.tr[s.tr.length - 1]; food(S, p[0], p[1], 0.5); } }
    s.boosting = boost;
  }
  // who hit whom this tick. Ramming someone's side right behind their head brings your head next to theirs too:
  // then only the one who did the ramming dies. Two snakes meeting head to head: the shorter one goes (both if equal).
  g = grid(S); const hits = new Map();
  for (const s of S.sn) { if (!s.alive) continue; const r = radius(s.L);
    if (Math.hypot(s.x, s.z) > S.R) { hits.set(s, { o: null, k: 0 }); continue; }   // the wall: only when the middle of the head crosses the line
    const o = hit(g, s.x, s.z, r, s, false); if (o) hits.set(s, { o, k: HIT.k }); }
  const FRONT = 2;
  for (const [s, h] of hits) { if (!s.alive) continue; const o = h.o, back = o && hits.get(o);
    if (o && back && back.o === s) {
      if (h.k <= FRONT && back.k <= FRONT) {
        // heads touching: whoever was driving into the other is to blame; only a real head-on goes by length
        const dx = o.x - s.x, dz = o.z - s.z, d = Math.hypot(dx, dz) || 1, mine = (Math.cos(s.a)*dx + Math.sin(s.a)*dz)/d, theirs = -(Math.cos(o.a)*dx + Math.sin(o.a)*dz)/d;
        if (theirs - mine > 0.35) continue;                       // they drove into me
        if (mine - theirs <= 0.35 && s.L > o.L + 0.5) continue;   // head-on: the longer one lives
      }
      else if (h.k < back.k) continue;                                            // I only touched the front of the one who rammed me
    }
    die(S, s, o); }
  // eating, and food the closing wall burns
  const keep = [];
  for (const f of S.food) { let eaten = false;
    if (Math.hypot(f[1], f[2]) > S.R - 0.3) eaten = true;
    else for (const s of S.sn) { if (!s.alive) continue; const r = radius(s.L) + 0.9, dx = f[1] - s.x, dz = f[2] - s.z; if (dx*dx + dz*dz < r*r) { s.L = q(s.L + f[3]); s.best = Math.max(s.best, s.L); eaten = true; S.ev.push({ t: 'eat', i: s.i, v: f[3] >= 1 ? 1 : 0 }); break; } }
    if (eaten) S.fr.push(f[0]); else keep.push(f); }
  S.food = keep; topUpFood(S);
  const alive = S.sn.filter((s) => s.alive), humansAlive = alive.filter((s) => !s.bot).length;
  // no clock: the round goes on until one snake is left (or no people are left in it)
  if (alive.length <= 1 || (S.humans > 0 && humansAlive === 0)) end(S);
}

function end(S) {
  S.ph = 'over';
  const alive = S.sn.filter((s) => s.alive).sort((a, b) => b.L - a.L); alive.forEach((s, k) => { s.place = k + 1; });
  // anyone still racing when the humans are gone shares the places above the humans
  S.ev.push({ t: 'over' });
}
export function results(S) { return S.sn.slice().sort((a, b) => a.place - b.place || b.L - a.L).map((s) => ({ i: s.i, id: s.id, name: s.name, bot: s.bot, place: s.place, L: Math.floor(s.best), kills: s.kills })); }

// ---- the wire --------------------------------------------------------------
// every tick: heads, length, a few flags; food that came and went; events. Every so often the whole picture.
export function snap(S, full) {
  const o = { tm: Math.round(S.tm*20), R: S.R, sn: S.sn.map((s) => [s.i, Math.round(s.x*100), Math.round(s.z*100), Math.round(s.a*100), Math.round(s.L*100), (s.alive ? 1 : 0) | (s.boosting ? 2 : 0)]), ev: S.ev };
  if (S.fa.length) o.fa = S.fa.map((f) => [f[0], Math.round(f[1]*100), Math.round(f[2]*100), Math.round(f[3]*10)]);
  if (S.fr.length) o.fr = S.fr;
  if (full) { o.full = 1; o.ph = S.ph; o.who = S.sn.map((s) => [s.id, s.name, s.bot ? 1 : 0, s.col]); o.tr = S.sn.map((s) => s.tr.map((p) => [Math.round(p[0]*100), Math.round(p[1]*100)])); o.food = S.food.map((f) => [f[0], Math.round(f[1]*100), Math.round(f[2]*100), Math.round(f[3]*10)]); }
  if (S.ph === 'over') { o.ph = 'over'; o.res = results(S); }
  return o;
}

// a phone's copy of the world, kept up to date from snapshots
export function mirror() { return { tm: 0, R: R0, ph: 'play', sn: [], food: new Map(), ready: false, res: null }; }
export function apply(M, o) {
  if (o.full) { M.ready = true; const old = M.sn; M.sn = o.who.map((w, i) => ({ i, id: w[0], name: w[1], bot: !!w[2], col: w[3], x: 0, z: 0, a: 0, L: L0, pL: L0, n: old[i] && old[i].id === w[0] ? old[i].n || 0 : 0, tr: o.tr[i].map((p) => [p[0]/100, p[1]/100]), alive: true, boosting: false, px: 0, pz: 0 }));
    M.food = new Map(); for (const f of o.food) M.food.set(f[0], [f[1]/100, f[2]/100, f[3]/10]); }
  if (!M.ready) return [];
  M.tm = o.tm/20; M.R = o.R; if (o.ph) M.ph = o.ph; if (o.res) M.res = o.res;
  for (const h of o.sn) { const s = M.sn[h[0]]; if (!s) continue; s.px = s.x; s.pz = s.z; s.pa = s.a;
    const x = h[1]/100, z = h[2]/100;
    // the server grew the body with last tick's length, so must we
    if (o.full) { s.x = x; s.z = z; s.px = x; s.pz = z; } else if (s.alive) addHead(s, x, z);
    s.pL = o.full ? h[4]/100 : s.L; s.L = h[4]/100; s.a = h[3]/100; if (o.full) s.pa = s.a; s.boosting = !!(h[5] & 2); s.alive = !!(h[5] & 1); }
  if (o.fr || o.fa || o.full) M.fv = (M.fv || 0) + 1;
  if (o.fr) for (const id of o.fr) M.food.delete(id);
  if (o.fa) for (const f of o.fa) M.food.set(f[0], [f[1]/100, f[2]/100, f[3]/10]);
  return o.ev || [];
}
