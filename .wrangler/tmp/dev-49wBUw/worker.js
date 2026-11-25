var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// sim.js
var TICK = 1 / 20;
var ROUND = 120;
var R0 = 48;
var RMIN = 18;
var SHRINK = 50;
var SEG = 0.5;
var V = 7;
var VB = 13;
var TURN = 3.6;
var L0 = 18;
var LMIN = 10;
var MAXS = 6;
var BOTS = ["\u041A\u043E\u0431\u0440\u0430", "\u041F\u0438\u0442\u043E\u043D", "\u041C\u0430\u043C\u0431\u0430", "\u0413\u0430\u0434\u044E\u043A\u0430", "\u0410\u043D\u0430\u043A\u043E\u043D\u0434\u0430", "\u0423\u0434\u0430\u0432", "\u0422\u0430\u0439\u043F\u0430\u043D", "\u0423\u0436"];
var radius = /* @__PURE__ */ __name((L) => 0.62 + Math.min(0.6, L / 450), "radius");
var arenaR = /* @__PURE__ */ __name((tm) => tm < SHRINK ? R0 : Math.max(RMIN, R0 - (R0 - RMIN) * (tm - SHRINK) / (ROUND - SHRINK - 10)), "arenaR");
var q = /* @__PURE__ */ __name((v) => Math.round(v * 100) / 100, "q");
var wrap = /* @__PURE__ */ __name((a) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}, "wrap");
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}
__name(rng, "rng");
function newGame(seed) {
  return { tm: -3, ph: "play", R: R0, rnd: rng(seed || Date.now()), sn: [], food: [], fid: 1, ev: [], fa: [], fr: [], deaths: 0, humans: 0 };
}
__name(newGame, "newGame");
function addHead(s, x, z) {
  const t = s.tr;
  s.x = x;
  s.z = z;
  if (!t.length) {
    t.push([x, z]);
    return;
  }
  for (let n = 0; n < 8; n++) {
    const p = t[0], dx = x - p[0], dz = z - p[1], d = Math.hypot(dx, dz);
    if (d < SEG) break;
    t.unshift([q(p[0] + dx / d * SEG), q(p[1] + dz / d * SEG)]);
    s.n = (s.n || 0) + 1;
  }
  const keep = Math.max(2, Math.ceil(s.L));
  if (t.length > keep) t.length = keep;
}
__name(addHead, "addHead");
function addSnake(S, id, name, bot) {
  if (S.sn.length >= MAXS) return null;
  const i = S.sn.length, ang = i / MAXS * Math.PI * 2 + 0.3, r = R0 * 0.62;
  const x = q(Math.cos(ang) * r), z = q(Math.sin(ang) * r), a = wrap(ang + Math.PI / 2);
  const s = {
    i,
    id: String(id),
    name: String(name).slice(0, 16),
    bot: !!bot,
    col: i,
    x,
    z,
    a,
    ta: a,
    boost: false,
    L: L0,
    tr: [],
    alive: true,
    kills: 0,
    place: 0,
    dropT: 0,
    best: L0,
    ai: bot ? { skill: 0.55 + S.rnd() * 0.4, goal: null, think: 0, hunt: 0 } : null
  };
  for (let k = Math.ceil(L0); k >= 0; k--) addHead(s, q(x - Math.cos(a) * k * SEG), q(z - Math.sin(a) * k * SEG));
  if (!bot) S.humans++;
  S.sn.push(s);
  return s;
}
__name(addSnake, "addSnake");
function fillBots(S) {
  let k = 0;
  const from = Math.floor(S.rnd() * 8);
  while (S.sn.length < MAXS) {
    addSnake(S, "bot" + k, BOTS[(from + k) % 8], true);
    k++;
  }
}
__name(fillBots, "fillBots");
function input(S, id, c) {
  const s = S.sn.find((v) => v.id === String(id));
  if (!s || !s.alive || !c) return;
  if (c.r === -1 || c.r === 0 || c.r === 1) {
    s.turn = c.r;
    if (!c.r) s.ta = s.a;
  } else if (Number.isFinite(c.a)) {
    s.turn = 0;
    s.ta = wrap(c.a);
  }
  s.boost = !!c.b;
}
__name(input, "input");
function removeHuman(S, id) {
  const s = S.sn.find((v) => v.id === String(id));
  if (s && s.alive) die(S, s, null);
}
__name(removeHuman, "removeHuman");
function food(S, x, z, v) {
  const f = [S.fid++, q(x), q(z), v];
  S.food.push(f);
  S.fa.push(f);
  return f;
}
__name(food, "food");
function topUpFood(S) {
  const want = 70 + 22 * S.sn.filter((s) => s.alive).length;
  for (let n = 0; S.food.length < want && n < 12; n++) {
    const r = Math.sqrt(S.rnd()) * (S.R - 3), a = S.rnd() * Math.PI * 2;
    food(S, Math.cos(a) * r, Math.sin(a) * r, S.rnd() < 0.1 ? 2 : 0.7);
  }
}
__name(topUpFood, "topUpFood");
function die(S, s, by) {
  s.alive = false;
  s.boost = false;
  s.place = S.sn.filter((v) => v.alive).length + 1;
  S.deaths++;
  if (by && by !== s) by.kills++;
  for (let k = 0; k < s.tr.length; k += 2) {
    const p = s.tr[k];
    if (Math.hypot(p[0], p[1]) < S.R - 1) food(S, p[0] + (S.rnd() - 0.5) * 0.8, p[1] + (S.rnd() - 0.5) * 0.8, 1.2);
  }
  S.ev.push({ t: "die", i: s.i, by: by && by !== s ? by.i : -1, x: s.x, z: s.z });
}
__name(die, "die");
var CELL = 3;
function grid(S) {
  const g = /* @__PURE__ */ new Map();
  for (const s of S.sn) {
    if (!s.alive) continue;
    const r = radius(s.L);
    for (let k = 0; k < s.tr.length; k++) {
      const p = s.tr[k], key = Math.floor(p[0] / CELL) * 1e3 + Math.floor(p[1] / CELL);
      let c = g.get(key);
      if (!c) g.set(key, c = []);
      c.push(s, p[0], p[1], r, k);
    }
  }
  return g;
}
__name(grid, "grid");
function hit(g, x, z, r, me, skipOwn) {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  for (let i = cx - 1; i <= cx + 1; i++) for (let j = cz - 1; j <= cz + 1; j++) {
    const c = g.get(i * 1e3 + j);
    if (!c) continue;
    for (let n = 0; n < c.length; n += 5) {
      const o = c[n];
      if (o === me) continue;
      const dx = c[n + 1] - x, dz = c[n + 2] - z, rr = c[n + 3] + r;
      if (dx * dx + dz * dz < rr * rr * 0.8) return o;
    }
  }
  return null;
}
__name(hit, "hit");
function think(S, s, g) {
  const A = s.ai;
  A.think -= TICK;
  const r = radius(s.L);
  const danger = /* @__PURE__ */ __name((a) => {
    let d = 0;
    for (let k = 1; k <= 5; k++) {
      const dist = k * 1.6 * (0.6 + A.skill * 0.6), x = s.x + Math.cos(a) * dist, z = s.z + Math.sin(a) * dist;
      if (Math.hypot(x, z) > S.R - r - 1) {
        d += 6 - k;
        continue;
      }
      if (hit(g, x, z, r + 0.4, s, true)) d += 6 - k;
    }
    return d;
  }, "danger");
  if (A.think <= 0) {
    A.think = 0.25 + S.rnd() * 0.2;
    let best = null, bs = -1;
    for (const f of S.food) {
      const dx = f[1] - s.x, dz = f[2] - s.z, d2 = dx * dx + dz * dz;
      if (d2 > 400) continue;
      const sc = f[3] / (d2 + 4);
      if (sc > bs) {
        bs = sc;
        best = [f[1], f[2]];
      }
    }
    A.hunt = 0;
    if (S.rnd() < A.skill * 0.5) for (const o of S.sn) {
      if (o === s || !o.alive || o.L > s.L * 1.3) continue;
      const d = Math.hypot(o.x - s.x, o.z - s.z);
      if (d < 12) {
        best = [o.x + Math.cos(o.a) * 4, o.z + Math.sin(o.a) * 4];
        A.hunt = 1;
        break;
      }
    }
    A.goal = best || [-s.x * 0.3, -s.z * 0.3];
  }
  const want = Math.atan2(A.goal[1] - s.z, A.goal[0] - s.x);
  let pick = want, low = 1e9;
  for (const off of [0, 0.4, -0.4, 0.9, -0.9, 1.5, -1.5, 2.2, -2.2]) {
    const a = s.a + off, d = danger(a), cost = d * 10 + Math.abs(wrap(a - want)) * (1.2 - A.skill * 0.5);
    if (cost < low) {
      low = cost;
      pick = a;
    }
  }
  s.ta = wrap(pick);
  s.boost = A.hunt && s.L > LMIN + 6 && danger(s.a) === 0 || low >= 10 && s.L > LMIN + 2 && S.rnd() < A.skill * 0.3;
}
__name(think, "think");
function step(S) {
  S.ev = [];
  S.fa = [];
  S.fr = [];
  if (S.ph !== "play") return;
  S.tm = q(S.tm + TICK);
  if (S.tm <= 0) return;
  S.R = q(arenaR(S.tm));
  let g = grid(S);
  for (const s of S.sn) if (s.alive && s.bot) think(S, s, g);
  for (const s of S.sn) {
    if (!s.alive) continue;
    const boost = s.boost && s.L > LMIN, turn = TURN * (boost ? 0.8 : 1) * TICK;
    if (s.turn) {
      s.a = wrap(s.a + s.turn * turn);
      s.ta = s.a;
    } else {
      const d = wrap(s.ta - s.a);
      s.a = wrap(s.a + Math.max(-turn, Math.min(turn, d)));
    }
    const v = (boost ? VB : V) * TICK;
    addHead(s, q(s.x + Math.cos(s.a) * v), q(s.z + Math.sin(s.a) * v));
    if (boost) {
      s.L = q(s.L - 1.6 * TICK);
      s.dropT += TICK;
      if (s.dropT > 0.35) {
        s.dropT = 0;
        const p = s.tr[s.tr.length - 1];
        food(S, p[0], p[1], 0.5);
      }
    }
    s.boosting = boost;
  }
  g = grid(S);
  for (const s of S.sn) {
    if (!s.alive) continue;
    const r = radius(s.L);
    if (Math.hypot(s.x, s.z) > S.R - r) {
      die(S, s, null);
      continue;
    }
    const o = hit(g, s.x, s.z, r, s, false);
    if (o) die(S, s, o);
  }
  const keep = [];
  for (const f of S.food) {
    let eaten = false;
    if (Math.hypot(f[1], f[2]) > S.R - 0.3) eaten = true;
    else for (const s of S.sn) {
      if (!s.alive) continue;
      const r = radius(s.L) + 0.9, dx = f[1] - s.x, dz = f[2] - s.z;
      if (dx * dx + dz * dz < r * r) {
        s.L = q(s.L + f[3]);
        s.best = Math.max(s.best, s.L);
        eaten = true;
        if (f[3] >= 1) S.ev.push({ t: "eat", i: s.i });
        break;
      }
    }
    if (eaten) S.fr.push(f[0]);
    else keep.push(f);
  }
  S.food = keep;
  topUpFood(S);
  const alive = S.sn.filter((s) => s.alive), humansAlive = alive.filter((s) => !s.bot).length;
  if (S.tm >= ROUND || alive.length <= 1 || S.humans > 0 && humansAlive === 0) end(S);
}
__name(step, "step");
function end(S) {
  S.ph = "over";
  const alive = S.sn.filter((s) => s.alive).sort((a, b) => b.L - a.L);
  alive.forEach((s, k) => {
    s.place = k + 1;
  });
  S.ev.push({ t: "over" });
}
__name(end, "end");
function results(S) {
  return S.sn.slice().sort((a, b) => a.place - b.place || b.L - a.L).map((s) => ({ i: s.i, id: s.id, name: s.name, bot: s.bot, place: s.place, L: Math.floor(s.best), kills: s.kills }));
}
__name(results, "results");
function snap(S, full) {
  const o = { tm: Math.round(S.tm * 20), R: S.R, sn: S.sn.map((s) => [s.i, Math.round(s.x * 100), Math.round(s.z * 100), Math.round(s.a * 100), Math.round(s.L * 100), (s.alive ? 1 : 0) | (s.boosting ? 2 : 0)]), ev: S.ev };
  if (S.fa.length) o.fa = S.fa.map((f) => [f[0], Math.round(f[1] * 100), Math.round(f[2] * 100), Math.round(f[3] * 10)]);
  if (S.fr.length) o.fr = S.fr;
  if (full) {
    o.full = 1;
    o.ph = S.ph;
    o.who = S.sn.map((s) => [s.id, s.name, s.bot ? 1 : 0, s.col]);
    o.tr = S.sn.map((s) => s.tr.map((p) => [Math.round(p[0] * 100), Math.round(p[1] * 100)]));
    o.food = S.food.map((f) => [f[0], Math.round(f[1] * 100), Math.round(f[2] * 100), Math.round(f[3] * 10)]);
  }
  if (S.ph === "over") {
    o.ph = "over";
    o.res = results(S);
  }
  return o;
}
__name(snap, "snap");

// server/worker.js
var CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400" };
var json = /* @__PURE__ */ __name((o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, CORS) }), "json");
var hex = /* @__PURE__ */ __name((buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join(""), "hex");
var enc = new TextEncoder();
async function hmac(key, msg) {
  const k = await crypto.subtle.importKey("raw", typeof key === "string" ? enc.encode(key) : key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(msg));
}
__name(hmac, "hmac");
function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
__name(same, "same");
var FRESH = 7 * 24 * 3600;
var MAXP = MAXS;
var TICK2 = 50;
var botName = /* @__PURE__ */ __name((env) => env.BOT_NAME || "NeonSnakesGameBot", "botName");
var link = /* @__PURE__ */ __name((env, id) => "https://t.me/" + botName(env) + "?startapp=r_" + id, "link");
var roomOk = /* @__PURE__ */ __name((id) => typeof id === "string" && /^[a-z0-9]{6,12}$/.test(id), "roomOk");
var newId = /* @__PURE__ */ __name(() => {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789", r = crypto.getRandomValues(new Uint8Array(8));
  let s = "";
  for (let i = 0; i < 8; i++) s += abc[r[i] % abc.length];
  return s;
}, "newId");
var cleanName = /* @__PURE__ */ __name((u) => String(u.first_name || u.username || "\u0418\u0433\u0440\u043E\u043A").replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 16) || "\u0418\u0433\u0440\u043E\u043A", "cleanName");
async function whoIs(init, env) {
  if (!init || typeof init !== "string" || init.length > 4096 || !env.BOT_TOKEN) return null;
  const p = new URLSearchParams(init), hash = p.get("hash");
  if (!hash) return null;
  const lines = [];
  for (const [k, v] of p) if (k !== "hash") lines.push(k + "=" + v);
  lines.sort();
  const secret = await hmac("WebAppData", env.BOT_TOKEN), sign = hex(await hmac(secret, lines.join("\n")));
  if (!same(sign, hash)) return null;
  const at = parseInt(p.get("auth_date") || "0", 10);
  if (!(at > 0) || Date.now() / 1e3 - at > FRESH) return null;
  let u = null;
  try {
    u = JSON.parse(p.get("user") || "null");
  } catch (e) {
  }
  if (!u || !Number.isSafeInteger(u.id)) return null;
  return { id: String(u.id), name: cleanName(u), uz: String(u.language_code || "").toLowerCase().indexOf("uz") === 0 };
}
__name(whoIs, "whoIs");
async function tg(env, method, body) {
  try {
    return await (await fetch("https://api.telegram.org/bot" + env.BOT_TOKEN + "/" + method, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
  } catch (e) {
    return null;
  }
}
__name(tg, "tg");
var Room = class {
  static {
    __name(this, "Room");
  }
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.socks = /* @__PURE__ */ new Map();
    this.S = null;
    this.ph = "lobby";
    this.timer = null;
    this.k = 0;
    this.acc = 0;
    this.last = 0;
  }
  people() {
    return [...this.socks.values()].filter((v, i, a) => a.findIndex((w) => w.id === v.id) === i);
  }
  lobby() {
    return { t: "lobby", ph: this.ph, players: this.people().map((p) => ({ id: p.id, name: p.name })) };
  }
  send(ws, o) {
    try {
      ws.send(typeof o === "string" ? o : JSON.stringify(o));
    } catch (e) {
    }
  }
  all(o) {
    const s = typeof o === "string" ? o : JSON.stringify(o);
    for (const ws of this.socks.keys()) this.send(ws, s);
  }
  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("ws only", { status: 426 });
    const id = request.headers.get("X-Uid");
    let name = "\u0418\u0433\u0440\u043E\u043A";
    try {
      name = decodeURIComponent(request.headers.get("X-Name") || "\u0418\u0433\u0440\u043E\u043A");
    } catch (e) {
    }
    const pair = new WebSocketPair(), [client, server] = Object.values(pair);
    server.accept();
    const here = this.people().map((p) => p.id);
    if (!here.includes(id) && here.length >= MAXP) {
      this.send(server, { t: "full" });
      try {
        server.close(4002, "full");
      } catch (e) {
      }
      return new Response(null, { status: 101, webSocket: client });
    }
    for (const [ws, v] of this.socks) if (v.id === id) {
      this.send(ws, { t: "bye", why: "again" });
      try {
        ws.close(4e3, "again");
      } catch (e) {
      }
      this.socks.delete(ws);
    }
    this.socks.set(server, { id, name, seen: Date.now() });
    this.sweepOn();
    this.send(server, { t: "hello", me: id });
    this.all(this.lobby());
    if (this.S) this.send(server, { t: "s", s: snap(this.S, true) });
    server.addEventListener("message", (e) => this.onMessage(server, e.data));
    const gone = /* @__PURE__ */ __name(() => this.leave(server), "gone");
    server.addEventListener("close", gone);
    server.addEventListener("error", gone);
    return new Response(null, { status: 101, webSocket: client });
  }
  onMessage(ws, data) {
    const me = this.socks.get(ws);
    if (!me || typeof data !== "string" || data.length > 300) return;
    me.seen = Date.now();
    let m;
    try {
      m = JSON.parse(data);
    } catch (e) {
      return;
    }
    if (m.t === "in" && this.ph === "play" && this.S && m.c && typeof m.c === "object") input(this.S, me.id, { a: +m.c.a, r: m.c.r === -1 || m.c.r === 1 || m.c.r === 0 ? m.c.r : void 0, b: !!m.c.b });
    else if (m.t === "start" && this.ph !== "play") this.start();
    else if (m.t === "ping") this.send(ws, { t: "pong" });
  }
  leave(ws) {
    const me = this.socks.get(ws);
    if (!me) return;
    this.socks.delete(ws);
    if (this.S && this.ph === "play" && !this.people().some((p) => p.id === me.id)) removeHuman(this.S, me.id);
    if (!this.socks.size) {
      this.stop();
      this.S = null;
      this.ph = "lobby";
      if (this.sweeper) {
        clearInterval(this.sweeper);
        this.sweeper = null;
      }
      return;
    }
    this.all(this.lobby());
  }
  // a phone that has gone quiet for 45 s is gone, even if its connection never said so (phones ping every 20 s)
  sweepOn() {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => {
      const t = Date.now();
      for (const [ws, v] of this.socks) if (t - v.seen > 45e3) {
        try {
          ws.close(4001, "quiet");
        } catch (e) {
        }
        this.leave(ws);
      }
    }, 1e4);
  }
  start() {
    const S = newGame(Date.now() & 2147483647);
    for (const p of this.people()) addSnake(S, p.id, p.name, false);
    fillBots(S);
    this.S = S;
    this.ph = "play";
    this.k = 0;
    this.acc = 0;
    this.last = Date.now();
    this.all(this.lobby());
    this.all({ t: "s", s: snap(S, true) });
    this.run();
  }
  run() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK2);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  tick() {
    const S = this.S;
    if (!S) return this.stop();
    const t = Date.now();
    this.acc += Math.min(500, t - this.last);
    this.last = t;
    let n = 0;
    while (this.acc >= TICK2 && n++ < 6) {
      this.acc -= TICK2;
      step(S);
      this.k++;
      this.all({ t: "s", s: snap(S, this.k % 40 === 0) });
      if (S.ph === "over") break;
    }
    if (S.ph === "over") {
      this.ph = "over";
      this.stop();
      this.all(this.lobby());
    }
  }
};
async function telegram(env, request) {
  if (!env.HOOK_SECRET || request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.HOOK_SECRET) return new Response("no", { status: 403 });
  let up = null;
  try {
    up = await request.json();
  } catch (e) {
    return new Response("ok");
  }
  const m = up && up.message;
  if (!m || !m.chat || typeof m.text !== "string") return new Response("ok");
  const cmd = m.text.trim().split(/[\s@]/)[0].toLowerCase(), uz = String(m.from && m.from.language_code || "").toLowerCase().indexOf("uz") === 0;
  if (cmd === "/game" || cmd === "/play" || cmd === "/start" && m.chat.type !== "private") {
    const id = newId(), who = m.from ? cleanName(m.from) : "";
    await tg(env, "sendMessage", { chat_id: m.chat.id, text: uz ? "\u{1F40D} " + who + " neon ilonlar jangiga chaqiryapti! 2\u20136 kishi, bo\u2018sh joylarni botlar egallaydi." : "\u{1F40D} " + who + " \u0437\u043E\u0432\u0451\u0442 \u043D\u0430 \u0430\u0440\u0435\u043D\u0443 \u041D\u0435\u043E\u043D \u0417\u043C\u0435\u0435\u043A! \u041E\u0442 2 \u0434\u043E 6 \u0447\u0435\u043B\u043E\u0432\u0435\u043A, \u0441\u0432\u043E\u0431\u043E\u0434\u043D\u044B\u0435 \u043C\u0435\u0441\u0442\u0430 \u0437\u0430\u0439\u043C\u0443\u0442 \u0431\u043E\u0442\u044B.", reply_markup: { inline_keyboard: [[{ text: uz ? "\u{1F3AE} Arenaga kirish" : "\u{1F3AE} \u041D\u0430 \u0430\u0440\u0435\u043D\u0443", url: link(env, id) }]] } });
  } else if (cmd === "/start" || cmd === "/help") {
    await tg(env, "sendMessage", { chat_id: m.chat.id, text: uz ? "Chiroqlarni yeng, o\u2018sing va boshqalarni dumingizga urilishga majbur qiling! Do\u2018stlar bilan: guruhga qo\u2018shing va /game yozing." : "\u0415\u0448\u044C \u043E\u0433\u043E\u043D\u044C\u043A\u0438, \u0440\u0430\u0441\u0442\u0438 \u0438 \u0437\u0430\u0441\u0442\u0430\u0432\u043B\u044F\u0439 \u0434\u0440\u0443\u0433\u0438\u0445 \u0432\u0440\u0435\u0437\u0430\u0442\u044C\u0441\u044F \u0432 \u0442\u0432\u043E\u0439 \u0445\u0432\u043E\u0441\u0442. \u041F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439 \u0436\u0438\u0432\u043E\u0439 \u2014 \u043F\u043E\u0431\u0435\u0434\u0438\u0442\u0435\u043B\u044C.\n\n\u0421 \u0434\u0440\u0443\u0437\u044C\u044F\u043C\u0438: \u0434\u043E\u0431\u0430\u0432\u044C \u043C\u0435\u043D\u044F \u0432 \u0433\u0440\u0443\u043F\u043F\u0443 \u0438 \u043D\u0430\u043F\u0438\u0448\u0438 /game.", reply_markup: { inline_keyboard: [[{ text: uz ? "\u{1F40D} O\u2018ynash" : "\u{1F40D} \u0418\u0433\u0440\u0430\u0442\u044C", url: "https://t.me/" + botName(env) + "?startapp=home" }]] } });
  }
  return new Response("ok");
}
__name(telegram, "telegram");
async function setup(env, origin) {
  const hook = await tg(env, "setWebhook", { url: origin + "/tg", secret_token: env.HOOK_SECRET, allowed_updates: ["message"] });
  const cmds = await tg(env, "setMyCommands", { commands: [{ command: "game", description: "\u041F\u043E\u0437\u0432\u0430\u0442\u044C \u0432\u0441\u0435\u0445 \u043D\u0430 \u0430\u0440\u0435\u043D\u0443" }, { command: "help", description: "\u041A\u0430\u043A \u0438\u0433\u0440\u0430\u0442\u044C" }] });
  return { webhook: !!(hook && hook.ok), commands: !!(cmds && cmds.ok) };
}
__name(setup, "setup");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url), path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
      if (path === "/ws") {
        const room = url.searchParams.get("room"), me = await whoIs(url.searchParams.get("init"), env);
        if (!roomOk(room)) return json({ ok: false, err: "room" }, 400);
        if (!me) return json({ ok: false, err: "auth" }, 401);
        const h = new Headers(request.headers);
        h.set("X-Uid", me.id);
        h.set("X-Name", encodeURIComponent(me.name));
        return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(new Request(request.url, { headers: h }));
      }
      if (path === "/new" && request.method === "POST") {
        let q2 = {};
        try {
          q2 = await request.json();
        } catch (e) {
        }
        const me = await whoIs(q2 && q2.init, env);
        if (!me) return json({ ok: false, err: "auth" }, 401);
        const id = newId();
        return json({ ok: true, id, link: link(env, id) });
      }
      if (path === "/share" && request.method === "POST") {
        let q2 = {};
        try {
          q2 = await request.json();
        } catch (e) {
        }
        const me = await whoIs(q2 && q2.init, env), room = String(q2 && q2.room || "");
        if (!me) return json({ ok: false, err: "auth" }, 401);
        if (!roomOk(room)) return json({ ok: false, err: "room" }, 400);
        const r = await tg(env, "savePreparedInlineMessage", { user_id: Number(me.id), allow_user_chats: true, allow_group_chats: true, result: { type: "article", id: "r" + room, title: "\u041D\u0435\u043E\u043D \u0417\u043C\u0435\u0439\u043A\u0438", description: me.uz ? "Arenaga taklif" : "\u041F\u0440\u0438\u0433\u043B\u0430\u0448\u0435\u043D\u0438\u0435 \u043D\u0430 \u0430\u0440\u0435\u043D\u0443", input_message_content: { message_text: me.uz ? "\u{1F40D} " + me.name + " neon ilonlar jangiga chaqiryapti! \u{1F447}" : "\u{1F40D} " + me.name + " \u0437\u043E\u0432\u0451\u0442 \u043D\u0430 \u0430\u0440\u0435\u043D\u0443 \u041D\u0435\u043E\u043D \u0417\u043C\u0435\u0435\u043A! \u0417\u0430\u0445\u043E\u0434\u0438 \u{1F447}" }, reply_markup: { inline_keyboard: [[{ text: me.uz ? "\u{1F3AE} Arenaga kirish" : "\u{1F3AE} \u041D\u0430 \u0430\u0440\u0435\u043D\u0443", url: link(env, room) }]] } } });
        return r && r.ok ? json({ ok: true, id: r.result.id }) : json({ ok: false, err: r && r.description || "tg" }, 502);
      }
      if (path === "/tg" && request.method === "POST") return await telegram(env, request);
      if (path === "/setup") {
        if (!env.HOOK_SECRET || url.searchParams.get("key") !== env.HOOK_SECRET) return json({ ok: false, err: "key" }, 403);
        return json(Object.assign({ ok: true }, await setup(env, url.origin)));
      }
      if (path === "/" || path === "/health") return json({ ok: true, name: "Neon Snakes", rooms: !!env.ROOMS, token: !!env.BOT_TOKEN, key: !!env.HOOK_SECRET });
      return json({ ok: false, err: "path" }, 404);
    } catch (e) {
      return json({ ok: false, err: "server", msg: String(e && e.message || e).slice(0, 200) }, 500);
    }
  }
};

// ../../../tmp/wr/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../tmp/wr/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-1J9qMD/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../../tmp/wr/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-1J9qMD/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  Room,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
