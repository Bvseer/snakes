// tournament: 3 new bots against 3 old bots, many rounds
import * as G from '../sim.js';
let wNew = 0, wOld = 0, kNew = 0, kOld = 0, surviveNew = 0, surviveOld = 0, N = 24, t = 0;
for (let seed = 1; seed <= N; seed++) { const S = G.newGame(seed*7919, { round: true }); S.tm = 0; G.fillBots(S); S.sn.forEach((s, i) => { s.ai.v = i % 2 ? 1 : 2; if (s.ai.v === 1) s.ai.skill = 0.55 + S.rnd()*0.4; });
  const t0 = Date.now(); let n = 0; while (S.ph === 'play' && n++ < 6000) G.step(S); t += Date.now() - t0;
  const w = G.results(S)[0], ws = S.sn[w.i]; if (ws.ai.v === 2) wNew++; else wOld++;
  for (const s of S.sn) { if (s.ai.v === 2) { kNew += s.kills; surviveNew += S.tm; } else kOld += s.kills; } }
console.log('wins new/old', wNew + '/' + wOld, '| kills new/old', kNew + '/' + kOld, '| avg sim ms per round', Math.round(t/N));
if (wNew < N*0.7) { console.log('FAIL strong bots are not strong'); process.exitCode = 1; }
