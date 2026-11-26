// no two snakes on the field ever wear the same colour, however people come, crash and come back
import * as G from '../sim.js';
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
ok(G.COLORS.length >= G.MAXS, 'there must be a colour for every snake that can be on the field');
ok(new Set(G.COLORS).size === G.COLORS.length, 'the colours themselves must differ');
for (const seed of [7, 42, 1234]) {
  const S = G.newGame(seed); G.fillBots(S); const people = ['u1', 'u2', 'u3', 'u4', 'u5']; let clash = 0, maxAlive = 0, came = 0;
  for (let t = 1; t <= 20*300; t++) {   // five minutes
    for (let k = 0; k < people.length; k++) { const id = people[k], me = S.sn.find((s) => s.alive && s.id === id);
      if (!me && t % (37 + k*11) === 0) { if (G.spawnHuman(S, id, 'P' + k)) came++; }            // comes in, or back after a crash
      else if (me && t % (613 + k*97) === 0) G.removeHuman(S, id);                                   // leaves
      else if (me && t % 9 === 0) G.input(S, id, { a: Math.atan2(-me.z, -me.x) + Math.sin(t/30 + k), b: t % 200 < 40 ? 1 : 0 }); }
    G.step(S);
    const alive = S.sn.filter((s) => s.alive), cols = new Set(alive.map((s) => s.col)); maxAlive = Math.max(maxAlive, alive.length);
    if (cols.size !== alive.length) { clash++; if (clash === 1) console.log('clash at tick', t, alive.map((s) => s.id + ':' + s.col).join(' ')); }
  }
  ok(clash === 0, 'seed ' + seed + ': two snakes shared a colour on ' + clash + ' ticks'); ok(came > 10 && maxAlive >= 10, 'seed ' + seed + ': the field should have been busy (' + came + ' arrivals, ' + maxAlive + ' at once)');
  console.log('seed', seed, 'arrivals', came, 'most at once', maxAlive, 'clashes', clash);
}
console.log(fails ? fails + ' FAILED' : 'all ok'); process.exit(fails ? 1 : 0);
