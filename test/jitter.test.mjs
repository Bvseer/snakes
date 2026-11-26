// ticks arrive unevenly over the air: the phone must keep the picture moving through the gaps
import * as G from '../sim.js';
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
// the way it used to be done: stay 1.4 ticks behind the newest tick heard
const oldPlay = (play, lastTick, dt) => { const target = lastTick - 1.4; let p = Math.abs(target - play) > 10 ? target : play + dt*20*(1 + Math.max(-0.12, Math.min(0.12, (target - play)*0.08))); return p > lastTick ? lastTick : p; };
function run(name, delay, secs) {   // delay(k) = ms that tick k spends on the way
  const arr = []; let prev = 0; for (let k = 0; k < secs*20; k++) { const t = Math.max(prev, k*50 + delay(k)); arr.push([t, k]); prev = t; }   // ticks cannot overtake each other
  const res = {}; for (const mode of ['old', 'new']) { const C = G.playClock(); let play = 0, last = 0, ai = 0, frozen = 0, back = 0, worst = 0, frames = 0, behind = 0, run0 = 0, speedMax = 0;
    for (let now = 0; now < secs*1000; now += 1000/60) { while (ai < arr.length && arr[ai][0] <= now) { last = arr[ai][1]; G.clockHeard(C, last, arr[ai][0]); ai++; }
      const before = play; play = mode === 'old' ? oldPlay(play, last, 1/60) : G.clockPlay(C, play, last, 1/60, now); if (now < 6000) continue;   // let it settle
      frames++; const d = play - before; if (d < -1e-9) back++; if (d < 0.02) { frozen++; run0++; worst = Math.max(worst, run0); } else run0 = 0; speedMax = Math.max(speedMax, d*3); behind += (now/50 - play); }
    res[mode] = { depth: +C.depth.toFixed(2), frozen: +(frozen/frames*100).toFixed(1), worst: Math.round(worst*1000/60), back, behind: Math.round(behind/frames*50), speedMax: +speedMax.toFixed(2) }; }
  console.log(name.padEnd(34), '| before: stood still', res.old.frozen + '% of frames, longest', res.old.worst, 'ms | now:', res.new.frozen + '%, longest', res.new.worst, 'ms, runs', res.new.behind, 'ms behind the arena, never faster than', res.new.speedMax + 'x');
  return res; }
let seed = 7; const rnd = () => { seed = (seed*1103515245 + 12345) & 0x7fffffff; return seed/0x7fffffff; };
const even = run('a good line (60 ms, steady)', () => 60, 40);
ok(even.new.frozen === 0 && even.new.behind < 160, 'a good line should play without stops and close behind: ' + JSON.stringify(even.new));
const wifi = run('home wifi (60 ms +- 40)', () => 60 + rnd()*40, 40);
ok(wifi.new.frozen < 0.5, 'ordinary jitter should not stop the picture: ' + JSON.stringify(wifi.new));
const mobile = run('mobile (90 ms +- 80)', () => 90 + rnd()*80, 40);
ok(mobile.new.frozen < 1, 'mobile jitter should not stop the picture: ' + JSON.stringify(mobile.new));
const burst = run('stalls (every 2 s nothing for 250 ms)', (k) => 70 + rnd()*20 + (k % 40 < 5 ? (5 - k % 40)*50 : 0), 60);
ok(burst.new.frozen < burst.old.frozen/4 && burst.new.worst <= 60, 'regular stalls should be ridden out: ' + JSON.stringify(burst));
const shift = run('the line gets 150 ms slower half-way', (k) => 60 + rnd()*20 + (k > 500 ? 150 : 0), 60);
ok(shift.new.frozen < 2 && shift.new.back === 0, 'a line that gets slower should be followed: ' + JSON.stringify(shift.new));
const lost = run('the arena loses half a second once', (k) => 60 + rnd()*20 + (k > 300 ? 500 : 0), 60);
ok(lost.new.depth < 2.6 && lost.new.frozen < 2, 'a one-off slip should be forgotten within half a minute, not held against the line: ' + JSON.stringify(lost.new));
const awful = run('a bad line (stalls of 400 ms every 1.5 s)', (k) => 100 + rnd()*40 + (k % 30 < 8 ? (8 - k % 30)*50 : 0), 60);
ok(awful.new.frozen < awful.old.frozen/3, 'on a bad line the picture should stand still far less than before: ' + JSON.stringify(awful));
for (const r of [even, wifi, mobile, burst, shift, lost, awful]) ok(r.new.back === 0 && r.new.speedMax <= 1.25, 'time must never run backwards or race: ' + JSON.stringify(r.new));
console.log(fails ? fails + ' FAILED' : 'all ok'); process.exit(fails ? 1 : 0);
