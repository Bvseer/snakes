// Neon snakes: the whole game in one place. The server runs it for rooms, the phone runs it for solo play,
// and phones use addHead() to rebuild every body from the heads the server sends, so bodies cost nothing on the wire.

export const VERSION = '1.31';   // one number for the page and the server: they tell each other which one they are
export const TICK = 1/20, ROUND = 120, R0 = 48, RMIN = 18, SHRINK = 50;   // seconds, units
export const SEG = 0.5, V = 7, VB = 13, TURN = 3.6, L0 = 18, LMIN = 10, MAXS = 12, ROUNDS = 6;
// the endless arena: much bigger, never closes in; at least BOTMIN snakes on it at any time
export const RE = 90, BOTMIN = 8, SAFE = 1.5;
export const COLORS = [0x00f0ff, 0xff2bd6, 0x7cff3a, 0xffb020, 0x9b6bff, 0xff4040, 0x30ffb0, 0xfff04a];
const BOTS = ['Кобра', 'Питон', 'Мамба', 'Гадюка', 'Анаконда', 'Удав', 'Тайпан', 'Уж', 'Гюрза', 'Эфа', 'Аспид', 'Полоз', 'Медянка', 'Боа', 'Ехидна', 'Крайт'];

export const radius = (L) => 0.62 + Math.min(0.6, L/450);
// how thick the body is along its length (f: 0 at the head, 1 at the tip of the tail): it thins out over the last fifth.
// The picture and the collisions both use this, so what looks like a miss is a miss.
export const taper = (f) => f < 0.8 ? 1 : 0.4 + 0.6*(1 - f)/0.2;
export const arenaR = (tm) => tm < SHRINK ? R0 : Math.max(RMIN, R0 - (R0 - RMIN)*(tm - SHRINK)/(ROUND - SHRINK - 10));
const q = (v) => Math.round(v*100)/100;
const wrap = (a) => { while (a > Math.PI) a -= 2*Math.PI; while (a < -Math.PI) a += 2*Math.PI; return a; };

// seeded random so a solo round and its replay agree; the server seeds from the clock
export function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s/4294967296; }; }

// Two kinds of game. The endless arena (what people play): big, never ends; snakes are born as others die and
// anyone can come in or come back at any time. The round (kept for tests and the bot tournament): last one standing.
export function newGame(seed, opt) {
  const round = !!(opt && opt.round), R = round ? R0 : RE;
  return { round, fixed: round ? !!opt.fixed : true, R0: R, tm: round ? -3 : 0, ph: 'play', R, rnd: rng(seed || Date.now()), sn: [], food: [], fid: 1, ev: [], fa: [], fr: [], deaths: 0, humans: 0, popT: 0, born: 0, pend: [], inStep: false };
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

// where to put a new snake in the endless arena: the spot furthest from every head and body, facing the open middle
function spawnSpot(S) {
  let best = null, bd = -1;
  for (let n = 0; n < 40; n++) { const r = Math.sqrt(0.05 + S.rnd()*0.7)*S.R, a = S.rnd()*Math.PI*2, x = Math.cos(a)*r, z = Math.sin(a)*r; let d = 1e9;
    for (const o of S.sn) { if (!o.alive) continue; for (let k = 0; k < o.tr.length; k += 4) { const p = o.tr[k], dd = (p[0] - x)*(p[0] - x) + (p[1] - z)*(p[1] - z); if (dd < d) d = dd; } }
    if (d > bd) { bd = d; best = [x, z]; } if (d > 400) break; }
  const ang = Math.atan2(-best[1], -best[0]) + (S.rnd() - 0.5)*1.2; return [q(best[0]), q(best[1]), wrap(ang)];
}
export function addSnake(S, id, name, bot) {
  let i, x, z, a;
  if (S.round) {
    if (S.sn.length >= ROUNDS) return null;
    i = S.sn.length; const ang = i/ROUNDS*Math.PI*2 + 0.3, r = R0*0.62;
    x = q(Math.cos(ang)*r); z = q(Math.sin(ang)*r); a = wrap(ang + Math.PI/2);   // everyone starts on a ring, going round it
  } else {
    // a free place: a new one, or one whose snake died a while ago (a person gets their own old one back)
    i = S.sn.findIndex((o) => !o.alive && o.id === String(id));
    if (i < 0) i = S.sn.findIndex((o) => !o.alive && o.bot && S.tm - (o.deadAt || 0) > 2);
    if (i < 0) { if (S.sn.length >= MAXS) return null; i = S.sn.length; }
    [x, z, a] = spawnSpot(S);
  }
  // a colour nobody else on the field is wearing, if there is one (a person keeps theirs)
  let col = i; if (!S.round) { if (S.sn[i] && S.sn[i].id === String(id)) col = S.sn[i].col; else { const used = COLORS.map((_, c) => S.sn.filter((o) => o.alive && o.col === c).length); const low = Math.min(...used); const free = used.map((u, c) => u === low ? c : -1).filter((c) => c >= 0); col = free[Math.floor(S.rnd()*free.length)]; } }
  const s = { i, id: String(id), name: String(name).slice(0, 16), bot: !!bot, col, x, z, a, ta: a, boost: false, L: L0, tr: [], alive: true, kills: 0, place: 0, dropT: 0, best: L0,
    safe: S.round ? 0 : S.tm + SAFE, born: S.tm, n: 0,
    ai: bot ? { skill: 0.8 + S.rnd()*0.2, goal: null, think: 0, hunt: 0, v: 2 } : null };
  // a short straight tail behind the start point
  for (let k = Math.ceil(L0); k >= 0; k--) addHead(s, q(x - Math.cos(a)*k*SEG), q(z - Math.sin(a)*k*SEG));
  if (!bot) S.humans++; S.sn[i] = s;
  // born between ticks (someone came in): told with the next tick, before it moves
  if (!S.round) (S.inStep ? S.ev : S.pend).push({ t: 'spawn', i, w: [s.id, s.name, s.bot ? 1 : 0, s.col], tr: s.tr.map((p) => [Math.round(p[0]*100), Math.round(p[1]*100)]), x: s.x, z: s.z, a: s.a });
  return s;
}
let botNo = 0;
// a bot with a name nobody on the field has right now
function addBot(S) { const k = botNo++, taken = new Set(S.sn.filter((o) => o.alive).map((o) => o.name)), free = BOTS.filter((n) => !taken.has(n)), pool = free.length ? free : BOTS;
  return addSnake(S, 'bot' + k + '_' + Math.floor(S.rnd()*1e6), pool[Math.floor(S.rnd()*pool.length)], true); }
export function fillBots(S) { if (S.round) { let k = 0; const from = Math.floor(S.rnd()*8); while (S.sn.length < ROUNDS) { addSnake(S, 'bot' + k, BOTS[(from + k) % 8], true); k++; } return; }
  while (S.sn.filter((o) => o.alive).length < BOTMIN && addBot(S)); }
// The game cannot hear a person's phone (a slow or broken connection): their snake blinks and cannot crash or be hit
// until it can. Whoever calls this decides for how long in total.
export function shield(S, id, sec) { const s = S.sn.find((v) => v.alive && v.id === String(id)); if (s) { s.safe = Math.max(s.safe || 0, S.tm + sec); s.boost = false; } return !!s; }   // and it stops dashing: nobody is there to want it
// A person's connection dropped: their snake is not thrown away, a bot's brain keeps it out of trouble until they are back.
export function autopilot(S, id, on) { const s = S.sn.find((v) => v.alive && v.id === String(id)); if (!s) return false;
  s.auto = !!on; if (on && !s.ai) s.ai = { skill: 0.9, goal: null, think: 0, hunt: 0, v: 2 }; if (!on) { s.boost = false; s.turn = 0; s.ta = s.a; } return true; }
// A person comes back into a world that no longer has their snake (the arena was restarted): the new one gets the length they had.
export function restore(S, id, L, kills) { const s = S.sn.find((v) => v.alive && v.id === String(id)); if (!s) return; s.L = q(Math.max(L0, Math.min(600, +L || L0))); s.best = s.L; s.kills = Math.max(0, kills | 0); }
// a person comes in, or comes back after crashing: into the arena at once
export function spawnHuman(S, id, name) { const s = S.sn.find((v) => v.alive && v.id === String(id)); return s || addSnake(S, id, name, false); }
// the endless arena keeps itself busy: whenever fewer snakes are alive than it wants, a bot is born (one a second at most)
function population(S) {
  S.popT -= TICK; if (S.popT > 0) return;
  const alive = S.sn.filter((o) => o.alive), people = alive.filter((o) => !o.bot).length, want = Math.min(MAXS, Math.max(BOTMIN, people + 7));
  if (alive.length < want) addBot(S);
  S.popT = alive.length + 1 < want ? 0.35 : 1;   // a big gap fills quickly, a small one at an easy pace
}
// two ways to steer: a heading to turn toward (finger), or "keep turning this way while the key is held" (keys)
export function input(S, id, c) { const s = S.sn.find((v) => v.alive && v.id === String(id)); if (!s || !c) return;
  if (c.r === -1 || c.r === 0 || c.r === 1) { s.turn = c.r; if (!c.r) s.ta = s.a; } else if (Number.isFinite(c.a)) { s.turn = 0; s.ta = wrap(c.a); }
  s.boost = !!c.b; }
export function removeHuman(S, id) { const s = S.sn.find((v) => v.alive && v.id === String(id)); if (s) die(S, s, null); }

function food(S, x, z, v, corpse) { const f = [S.fid++, q(x), q(z), v, corpse ? S.tm : -1]; S.food.push(f); S.fa.push(f); return f; }
function topUpFood(S) {
  const n = S.sn.filter((s) => s.alive).length, want = S.round ? 70 + 22*n : 440 + 20*n;
  for (let n = 0; S.food.length < want && n < 12; n++) { const r = Math.sqrt(S.rnd())*(S.R - 3), a = S.rnd()*Math.PI*2; food(S, Math.cos(a)*r, Math.sin(a)*r, S.rnd() < 0.1 ? 2 : 0.7); }
}

function die(S, s, by) {
  s.alive = false; s.boost = false; s.deadAt = S.tm; s.place = S.sn.filter((v) => v.alive).length + 1; S.deaths++;
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
  if (!s.auto && s.L > LMIN + 8 && S.rnd() < 0.35 + A.skill*0.45) {
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
  if (!S.fixed && S.tm > SHRINK - 5 && Math.hypot(s.x, s.z) > S.R*0.65) best = [s.x*0.3, s.z*0.3];
  A.goal = best || [-s.x*0.3, -s.z*0.3];
}
function think2(S, s, g) {
  const A = s.ai, r = radius(s.L), H = 0.8 + A.skill*0.6, closing = !S.fixed && S.tm > SHRINK - 3;
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
  s.boost = !s.auto && canDash && ((A.boostWant && Math.abs(wrap(pick - want)) < 0.45) || pickT < H*0.6) && fly(pick, true) === Infinity;   // someone's snake on autopilot never spends their length
}

// ---- the squeeze ------------------------------------------------------------
// A snake whose body goes all the way round someone else's head has that snake in a coil. For as long as the coil
// holds, it draws in towards its middle like a constrictor: gently at first, then steadily, until there is no room
// left inside. It is judged by how far round the body winds, not by the head touching the body, so the pull does
// not stutter while the snake keeps circling.
export const SQUEEZE = 0.45, COILMIN = 2.2;   // units per second the coil closes in; the tightest it gets
export function squeeze(s, k, cx, cz, f) { const t = s.tr; for (let i = 0; i <= k && i < t.length; i++) t[i] = [q(cx + (t[i][0] - cx)*f), q(cz + (t[i][1] - cz)*f)]; }
function coil(S, s) {
  const t = s.tr, r = radius(s.L), reach = s.L*SEG/Math.PI + 1, gapMax = 3 + 3*r;
  let k = -1, who = null;
  if (t.length >= 24) for (const o of S.sn) { if (o === s || !o.alive || o.safe > S.tm) continue; const hx = o.x - s.x, hz = o.z - s.z; if (hx*hx + hz*hz > reach*reach) continue;
    // walk back along my body, adding up the angle it sweeps around their head: a full turn is a coil
    let w = 0, pa = Math.atan2(t[0][1] - o.z, t[0][0] - o.x), at = -1;
    for (let i = 1; i < t.length; i++) { const a = Math.atan2(t[i][1] - o.z, t[i][0] - o.x); w += wrap(a - pa); pa = a; if (w >= 2*Math.PI || w <= -2*Math.PI) { at = i; break; } }
    if (at < 0 || Math.hypot(t[at][0] - t[0][0], t[at][1] - t[0][1]) > gapMax) continue;   // not all the way round, or the way out is still wide open
    if (k < 0 || at < k) { k = at; who = o; } }
  if (k < 0) { s.coilT = Math.max(0, (s.coilT || 0) - 2*TICK); if (!s.coilT) s.coilC = null; return; }
  let cx = 0, cz = 0; for (let i = 0; i <= k; i++) { cx += t[i][0]; cz += t[i][1]; } cx /= k + 1; cz /= k + 1;
  // the middle it pulls towards moves smoothly, or the whole coil would shiver
  if (s.coilC) { cx = s.coilC[0] + (cx - s.coilC[0])*0.25; cz = s.coilC[1] + (cz - s.coilC[1])*0.25; } s.coilC = [cx, cz];
  let rad = 0; for (let i = 0; i <= k; i++) rad += Math.hypot(t[i][0] - cx, t[i][1] - cz); rad /= k + 1;
  s.coilT = Math.min(2.5, (s.coilT || 0) + TICK); const e = Math.min(1, s.coilT/2.5), ease = e*e*(3 - 2*e);   // two and a half seconds to reach full pull
  const f = rad <= COILMIN ? 1 : Math.max(0.9, 1 - SQUEEZE*ease*TICK/rad); cx = q(cx); cz = q(cz);
  if (f < 1) squeeze(s, k, cx, cz, f);
  S.ev.push({ t: 'sq', i: s.i, k, cx, cz, f, v: who.i, r: q(rad) });
}

// a newborn stops blinking only once it is clear of everyone: is its head on someone's body, or someone's head on its body?
function overlaps(S, s) {
  const r = radius(s.L);
  for (const o of S.sn) { if (o === s || !o.alive) continue; const rr = (r + radius(o.L))*(r + radius(o.L));
    for (const p of s.tr) if ((p[0] - o.x)*(p[0] - o.x) + (p[1] - o.z)*(p[1] - o.z) < rr) return true;
    for (const p of o.tr) if ((p[0] - s.x)*(p[0] - s.x) + (p[1] - s.z)*(p[1] - s.z) < rr) return true; }
  return false;
}

// every body point, by cell, for collisions and for bots looking where they go
const CELL = 3, HIT = { k: 0 };
function grid(S) {
  const g = new Map();
  for (const s of S.sn) { if (!s.alive || s.safe > S.tm) continue; const r = radius(s.L), n1 = Math.max(1, s.tr.length - 1);
    for (let k = 0; k < s.tr.length; k++) { const p = s.tr[k], key = Math.floor(p[0]/CELL)*1000 + Math.floor(p[1]/CELL); let c = g.get(key); if (!c) g.set(key, c = []); c.push(s, p[0], p[1], r*taper(k/n1), k); } }
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
  S.ev = S.pend || []; S.pend = []; S.fa = []; S.fr = []; S.inStep = true;
  try { stepIn(S); } finally { S.inStep = false; }
}
function stepIn(S) {
  if (S.ph !== 'play') return;
  S.tm = q(S.tm + TICK); if (S.tm <= 0) return;   // three seconds to look around before anyone moves
  S.R = S.fixed ? S.R0 : q(arenaR(S.tm));   // fixed: the arena never closes in
  let g = grid(S);
  for (const s of S.sn) if (s.alive && (s.bot || s.auto)) (s.ai.v === 1 ? think : think2)(S, s, g);
  // move: turn toward where the finger points, then straight ahead for one tick
  for (const s of S.sn) { if (!s.alive) continue;
    // a blinking snake (newborn, or its owner's connection is failing) cannot defend itself: it is turned away from the wall
    if (s.safe > S.tm && s.x*s.x + s.z*s.z > (S.R - 8)*(S.R - 8)) { s.turn = 0; s.ta = Math.atan2(-s.z, -s.x); s.boost = false; }
    const boost = s.boost && s.L > LMIN, turn = TURN*(boost ? 0.8 : 1)*TICK;
    if (s.turn) { s.a = wrap(s.a + s.turn*turn); s.ta = s.a; }
    else { const d = wrap(s.ta - s.a); s.a = wrap(s.a + Math.max(-turn, Math.min(turn, d))); }
    const v = (boost ? VB : V)*TICK; addHead(s, q(s.x + Math.cos(s.a)*v), q(s.z + Math.sin(s.a)*v));
    if (boost) { s.L = q(s.L - 1.6*TICK); s.dropT += TICK; if (s.dropT > 0.35) { s.dropT = 0; const p = s.tr[s.tr.length - 1]; food(S, p[0], p[1], 0.5); } }
    s.boosting = boost;
  }
  // the blinking ends only once the snake is clear of everyone (for a few seconds at most), never while lying across someone
  for (const s of S.sn) if (s.alive && s.safe && s.safe <= S.tm) { if (overlaps(S, s) && (s.ext = (s.ext || 0) + 1) <= 20) s.safe = S.tm + 0.3; else { s.safe = 0; s.ext = 0; } }
  for (const s of S.sn) if (s.alive) coil(S, s);
  // who hit whom this tick. Ramming someone's side right behind their head brings your head next to theirs too:
  // then only the one who did the ramming dies. Two snakes meeting head to head: the shorter one goes (both if equal).
  g = grid(S); const hits = new Map();
  for (const s of S.sn) { if (!s.alive) continue; const r = radius(s.L);
    if (Math.hypot(s.x, s.z) > S.R) { hits.set(s, { o: null, k: 0 }); continue; }   // the wall: only when the middle of the head crosses the line
    if (s.safe > S.tm) continue;   // just born: blinking, cannot crash into anyone yet
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
  if (!S.round) { population(S); return; }   // the endless arena never ends
  const alive = S.sn.filter((s) => s.alive), humansAlive = alive.filter((s) => !s.bot).length;
  // a round: no clock, it goes on until one snake is left (or no people are left in it)
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
  const o = { tm: Math.round(S.tm*20), R: S.R, sn: S.sn.map((s) => [s.i, Math.round(s.x*100), Math.round(s.z*100), Math.round(s.a*100), Math.round(s.L*100), (s.alive ? 1 : 0) | (s.boosting ? 2 : 0) | (s.alive && s.safe > S.tm ? 4 : 0)]), ev: S.ev };
  if (S.fa.length) o.fa = S.fa.map((f) => [f[0], Math.round(f[1]*100), Math.round(f[2]*100), Math.round(f[3]*10)]);
  if (S.fr.length) o.fr = S.fr;
  if (full) { o.full = 1; o.fixed = S.fixed ? 1 : 0; o.R0 = S.R0; o.ph = S.ph; o.who = S.sn.map((s) => [s.id, s.name, s.bot ? 1 : 0, s.col]); o.tr = S.sn.map((s) => s.tr.map((p) => [Math.round(p[0]*100), Math.round(p[1]*100)])); o.food = S.food.map((f) => [f[0], Math.round(f[1]*100), Math.round(f[2]*100), Math.round(f[3]*10)]); }
  if (S.ph === 'over') { o.ph = 'over'; o.res = results(S); }
  return o;
}

// a phone's copy of the world, kept up to date from snapshots
export function mirror() { return { fixed: false, R0: RE, tm: 0, R: RE, ph: 'play', sn: [], food: new Map(), ready: false, res: null }; }
export function apply(M, o) {
  if (o.full) { M.ready = true; M.fixed = !!o.fixed; M.R0 = o.R0 || R0; const old = M.sn; M.sn = o.who.map((w, i) => ({ i, id: w[0], name: w[1], bot: !!w[2], col: w[3], x: 0, z: 0, a: 0, L: L0, pL: L0, n: old[i] && old[i].id === w[0] ? old[i].n || 0 : 0, tr: o.tr[i].map((p) => [p[0]/100, p[1]/100]), alive: true, boosting: false, safe: false, kills: 0, px: 0, pz: 0 }));
    M.food = new Map(); for (const f of o.food) M.food.set(f[0], [f[1]/100, f[2]/100, f[3]/10]); }
  if (!M.ready) return [];
  M.tm = o.tm/20; M.R = o.R; if (o.ph) M.ph = o.ph; if (o.res) M.res = o.res;
  if (o.ev && !o.full) for (const e of o.ev) if (e.t === 'spawn')
    M.sn[e.i] = { i: e.i, id: e.w[0], name: e.w[1], bot: !!e.w[2], col: e.w[3], x: e.x, z: e.z, a: e.a, pa: e.a, px: e.x, pz: e.z, L: L0, pL: L0, n: 0, tr: e.tr.map((p) => [p[0]/100, p[1]/100]), alive: true, boosting: false, safe: true, kills: 0 };
  for (const h of o.sn) { const s = M.sn[h[0]]; if (!s) continue; s.px = s.x; s.pz = s.z; s.pa = s.a;
    const x = h[1]/100, z = h[2]/100;
    // the server grew the body with last tick's length, so must we
    if (o.full) { s.x = x; s.z = z; s.px = x; s.pz = z; } else if (s.alive) addHead(s, x, z);
    s.pL = o.full ? h[4]/100 : s.L; s.L = h[4]/100; s.a = h[3]/100; if (o.full) s.pa = s.a; s.boosting = !!(h[5] & 2); s.safe = !!(h[5] & 4); s.alive = !!(h[5] & 1); }
  if (o.ev && !o.full) for (const e of o.ev) {
    // the coil tightened this tick: the same pull here, and what the picture needs to show it (who, how tight, when)
    if (e.t === 'sq' && M.sn[e.i]) { const c = M.sn[e.i]; if (e.f < 1) squeeze(c, e.k, e.cx, e.cz, e.f); c.sq = { k: e.k, cx: e.cx, cz: e.cz, f: e.f, v: e.v, r: e.r, tm: o.tm }; }
  }
  if (o.fr || o.fa || o.full) M.fv = (M.fv || 0) + 1;
  if (o.fr) for (const id of o.fr) M.food.delete(id);
  if (o.fa) for (const f of o.fa) M.food.set(f[0], [f[1]/100, f[2]/100, f[3]/10]);
  return o.ev || [];
}
