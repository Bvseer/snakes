// the endless arena: it never ends, keeps itself populated, takes people in and back at any time,
// and a phone following along from snapshots stays identical through every birth and death
import * as G from '../sim.js';
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
const S = G.newGame(42); G.fillBots(S); const M = G.mirror(); G.apply(M, JSON.parse(JSON.stringify(G.snap(S, true))));
let births = 0, deaths = 0, drift = 0, minAlive = 99, bytes = 0, maxB = 0, myDeaths = 0, joinedAt = 0;
const t0 = performance.now();
for (let t = 1; t <= 20*240; t++) {   // four minutes
  if (t === 200) { G.spawnHuman(S, 'u1', 'Basir'); joinedAt = t; }                 // someone comes in half-way through a tick
  const me = S.sn.find((s) => s.alive && s.id === 'u1');
  if (me && t % 10 === 0) G.input(S, 'u1', { a: Math.atan2(-me.z, -me.x) + Math.sin(t/40), b: 0 });
  if (!me && joinedAt && t % 60 === 0) { G.spawnHuman(S, 'u1', 'Basir'); }          // crashed: back in a moment later
  G.step(S); const js = JSON.stringify(G.snap(S, t % 200 === 0)); bytes += js.length; if (t % 200) maxB = Math.max(maxB, js.length); G.apply(M, JSON.parse(js));
  for (const e of S.ev) { if (e.t === 'spawn') births++; if (e.t === 'die') { deaths++; if (S.sn[e.i].id === 'u1') myDeaths++; } }
  const alive = S.sn.filter((s) => s.alive); if (t > 40) minAlive = Math.min(minAlive, alive.length);
  for (const s of S.sn) { if (!s.alive) continue; const m = M.sn[s.i]; if (!m || m.id !== s.id || m.tr.length !== s.tr.length || m.tr.some((p, k) => p[0] !== s.tr[k][0] || p[1] !== s.tr[k][1])) drift++; }
}
console.log('4 min: births', births, 'deaths', deaths, '| my crashes', myDeaths, '| fewest alive', minAlive, '| slots', S.sn.length, '| phone drift', drift, '| avg', Math.round(bytes/4800), 'B/tick, max', maxB, '| sim', ((performance.now() - t0)/4800).toFixed(2), 'ms/tick | R', S.R);
ok(S.ph === 'play', 'never ends'); ok(drift === 0, 'phone copy identical'); ok(minAlive >= G.BOTMIN - 2, 'arena stays busy'); ok(births > 8 && deaths > 3, 'snakes are born and die');
ok(S.sn.length <= G.MAXS, 'no more than MAXS places'); ok(S.R === G.RE, 'big arena, never closes in');
// a newborn blinks: it cannot be hit and cannot crash for the first moments
{ const S2 = G.newGame(7); const a = G.spawnHuman(S2, 'x', 'X'); ok(a.safe > S2.tm, 'newborn is protected'); G.step(S2); const s0 = S2.sn.find((s) => s.id === 'x'); ok(s0.alive, 'newborn alive'); }
console.log(fails ? fails + ' FAILED' : 'endless ok'); if (fails) process.exitCode = 1;
