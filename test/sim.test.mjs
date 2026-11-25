import * as G from '../sim.js';
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
// a room of six bots plays to the end; a phone follows along from snapshots and must agree on every body point
for (let seed = 1; seed <= 5; seed++) {
  const S = G.newGame(seed); G.fillBots(S); const M = G.mirror(); let ticks = 0, bytes = 0, maxB = 0, mism = 0;
  G.apply(M, JSON.parse(JSON.stringify(G.snap(S, true))));
  while (S.ph === 'play' && ticks < 3000) { G.step(S); ticks++; const full = ticks % 40 === 0, js = JSON.stringify(G.snap(S, full)); bytes += js.length; if (!full) maxB = Math.max(maxB, js.length); G.apply(M, JSON.parse(js));
    for (const s of S.sn) { if (!s.alive) continue; const m = M.sn[s.i]; if (m.tr.length !== s.tr.length || m.tr.some((p, k) => p[0] !== s.tr[k][0] || p[1] !== s.tr[k][1])) mism++; } }
  const res = G.results(S);
  console.log('seed', seed, 'ticks', ticks, 'time', S.tm.toFixed(1), 'deaths', S.deaths, 'winner', res[0].name, 'L', res[0].L, 'kills', res.map((r) => r.kills).join(''), 'avg', Math.round(bytes/ticks), 'B max', maxB, 'B mismatches', mism);
  ok(mism === 0, 'mirror drift seed ' + seed); ok(S.ph === 'over', 'round ends');
}
// a human: dying ends the round, turning works, food makes you longer
{ const S = G.newGame(9); S.tm = 0; const me = G.addSnake(S, 'u1', 'Basir', false); G.fillBots(S); ok(S.sn.length === 6, 'six snakes');
  const L = me.L; S.food.push([999, me.x + Math.cos(me.a)*0.5, me.z + Math.sin(me.a)*0.5, 2]); G.step(S); ok(me.L > L + 1.5, 'eats food');
  G.input(S, 'u1', { a: me.a + 1.5, b: 0 }); const a0 = me.a; G.step(S); ok(Math.abs(me.a - a0) > 0.1 && Math.abs(me.a - a0) < 0.2, 'turns at limited rate');
  G.input(S, 'u1', { a: Math.atan2(me.z, me.x), b: 1 }); let n = 0; while (me.alive && n++ < 400) { G.input(S, 'u1', { a: Math.atan2(me.z, me.x), b: 1 }); G.step(S); }
  ok(!me.alive, 'hits the wall'); ok(S.ph === 'over', 'round over when the only human dies'); }
console.log(fails ? fails + ' FAILED' : 'all ok');
// keys: turning stops on the very tick the key is let go
{ const S = G.newGame(3); S.tm = 0; const me = G.addSnake(S, 'k', 'K', false); G.fillBots(S);
  const a0 = me.a; G.input(S, 'k', { r: 1 }); for (let i = 0; i < 5; i++) G.step(S); const a1 = me.a; G.input(S, 'k', { r: 0 }); G.step(S); G.step(S); G.step(S);
  console.log('turn while held:', (a1 - a0).toFixed(2), 'after release:', (me.a - a1).toFixed(3)); if (Math.abs(me.a - a1) > 1e-9 || a1 - a0 < 0.8) { console.log('FAIL key turning'); process.exitCode = 1; } }
// ramming: A drives its head into B's side right behind B's head; only A dies
{ const S = G.newGame(4); S.tm = 0; const A = G.addSnake(S, 'a', 'A', false), B = G.addSnake(S, 'b', 'B', false);
  // B lies along +x with its head at (0,0); A comes down from above, its head just touching B's neck
  B.tr = []; B.n = 0; for (let k = 40; k >= 0; k--) G.addHead(B, -k*G.SEG, 0); B.a = 0; B.ta = 0;
  A.tr = []; A.n = 0; for (let k = 40; k >= 0; k--) G.addHead(A, -0.9, -2.2 - k*G.SEG + 2.2 - 0.3 + 0.0); A.a = Math.PI/2; A.ta = A.a;
  A.x = -0.9; A.z = -1.2; G.addHead(A, -0.9, -0.55);
  G.step(S); console.log('ram from the side: A', A.alive ? 'alive' : 'dead', '| B', B.alive ? 'alive' : 'dead'); if (A.alive || !B.alive) { console.log('FAIL ram rule'); process.exitCode = 1; } }
// head to head: the shorter goes
{ const S = G.newGame(5); S.tm = 0; const A = G.addSnake(S, 'a', 'A', false), B = G.addSnake(S, 'b', 'B', false);
  A.tr = []; B.tr = []; for (let k = 30; k >= 0; k--) { G.addHead(A, -0.7 - k*G.SEG, 0); G.addHead(B, 0.7 + k*G.SEG, 0); } A.a = 0; A.ta = 0; B.a = Math.PI; B.ta = Math.PI; A.L = 40; B.L = 25;
  G.step(S); console.log('head to head: longer A', A.alive ? 'alive' : 'dead', '| shorter B', B.alive ? 'alive' : 'dead'); if (!A.alive || B.alive) { console.log('FAIL head rule'); process.exitCode = 1; } }
// a snake dies: bots nearby race to its remains
{ let came = 0, total = 0;
  for (let seed = 20; seed < 30; seed++) { const S = G.newGame(seed); S.tm = 0; G.fillBots(S); for (let i = 0; i < 40; i++) G.step(S);
    const v = S.sn.find((s) => s.alive), others = S.sn.filter((s) => s.alive && s !== v && Math.hypot(s.x - v.x, s.z - v.z) < 26);
    if (!others.length) continue; const spot = [v.x, v.z], before = others.map((o) => Math.hypot(o.x - spot[0], o.z - spot[1]));
    v.alive = false; v.L = 60; v.tr = v.tr.length ? v.tr : [[v.x, v.z]]; for (let k = 0; k < 30; k++) S.food.push([S.fid++, v.x + (k%6) - 3, v.z + Math.floor(k/6) - 2, 1.2, S.tm]);
    for (let i = 0; i < 70; i++) G.step(S);
    others.forEach((o, j) => { total++; if (Math.hypot(o.x - spot[0], o.z - spot[1]) < before[j] - 3 || o.L > 40) came++; }); }
  console.log('bots that rushed to the remains:', came + '/' + total); if (came < total*0.6) { console.log('FAIL bots ignore corpses'); process.exitCode = 1; } }
