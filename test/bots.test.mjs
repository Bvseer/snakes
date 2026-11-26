// tournament: 3 new bots against 3 old bots, many rounds
import * as G from '../sim.js';
let wNew = 0, wOld = 0, kNew = 0, kOld = 0, surviveNew = 0, surviveOld = 0, N = 24, t = 0;
for (let seed = 1; seed <= N; seed++) { const S = G.newGame(seed*7919, { round: true }); S.tm = 0; G.fillBots(S); S.sn.forEach((s, i) => { s.ai.v = i % 2 ? 1 : 2; if (s.ai.v === 1) s.ai.skill = 0.55 + S.rnd()*0.4; });
  const t0 = Date.now(); let n = 0; while (S.ph === 'play' && n++ < 6000) G.step(S); t += Date.now() - t0;
  const w = G.results(S)[0], ws = S.sn[w.i]; if (ws.ai.v === 2) wNew++; else wOld++;
  for (const s of S.sn) { if (s.ai.v === 2) { kNew += s.kills; surviveNew += S.tm; } else kOld += s.kills; } }
console.log('wins new/old', wNew + '/' + wOld, '| kills new/old', kNew + '/' + kOld, '| avg sim ms per round', Math.round(t/N));
if (wNew < N*0.7) { console.log('FAIL strong bots are not strong'); process.exitCode = 1; }

// bots wrap round a smaller snake and squeeze it; and bots go right up to the edge of the arena
{ const { newGame, addSnake, addHead, fillBots, input, step, spawnHuman, SEG, RE } = await import('../sim.js'); const q = (v) => Math.round(v*100)/100; let closed = 0, killed = 0, tries = 8;
  for (let seed = 1; seed <= tries; seed++) { const S = newGame(seed); fillBots(S); const bot = S.sn.find((s) => s.alive && s.bot); for (const s of S.sn) if (s !== bot) s.alive = false;
    bot.x = 0; bot.z = -9; bot.a = 0; bot.ta = 0; bot.L = 110; bot.tr = []; for (let k = 110; k >= 0; k--) addHead(bot, q(-k*SEG), -9); bot.safe = 0;
    const me = spawnHuman(S, 'u1', 'Prey'); me.x = 0; me.z = 0; me.a = 0; me.L = 24; me.tr = []; for (let k = 24; k >= 0; k--) addHead(me, q(-k*SEG*0.5), 0); me.safe = 0;
    let got = false; for (let t = 0; t < 20*35 && me.alive && bot.alive; t++) { for (const s of S.sn) if (s !== bot && s !== me && s.alive) { s.alive = false; }   // nobody else gets in the way
      input(S, 'u1', { r: 1, b: 0 }); step(S); if (S.ev.some((e) => e.t === 'sq' && e.i === bot.i && e.v === me.i)) got = true; }
    if (got) closed++; if (got && !me.alive) killed++; }
  console.log('bots wrap round a snake going in circles: ring closed in', closed + '/' + tries, '| squeezed to death in', killed + '/' + tries);
  if (closed < 5) { console.log('FAIL bots do not coil'); process.exitCode = 1; }
  // five minutes of a busy arena: how close to the wall do bots get, and how many die on it
  const S = newGame(11); fillBots(S); let near = 0, n = 0, wallDeaths = 0, deaths = 0; for (let t = 0; t < 20*300; t++) { step(S); for (const e of S.ev) if (e.t === 'die') { deaths++; if (Math.hypot(e.x, e.z) > RE - 1.2) wallDeaths++; } if (t % 10 === 0) for (const s of S.sn) if (s.alive && s.bot) { n++; if (Math.hypot(s.x, s.z) > RE - 3) near++; } }
  console.log('bots within 3 of the wall', (near/n*100).toFixed(1) + '% of the time | deaths', deaths, 'of them at the wall', wallDeaths);
  if (near/n < 0.01) { console.log('FAIL bots keep away from the edge'); process.exitCode = 1; } if (wallDeaths > deaths*0.25 + 2) { console.log('FAIL bots kill themselves on the wall'); process.exitCode = 1; } }
