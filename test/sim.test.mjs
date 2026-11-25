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
