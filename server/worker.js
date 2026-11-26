// Neon snakes online: a room is a Durable Object that runs sim.js twenty times a second and sends every phone
// the heads, lengths and food changes; phones rebuild the bodies themselves. The bot posts rooms into group chats.
import * as G from '../sim.js';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' };
const json = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, CORS) });
const hex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
const enc = new TextEncoder();
async function hmac(key, msg) { const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return crypto.subtle.sign('HMAC', k, enc.encode(msg)); }
function same(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
const FRESH = 7*24*3600, MAXP = G.MAXS - 2, TICK = 50;
const botName = (env) => env.BOT_NAME || 'NeonSnakesGameBot';
const link = (env, id) => 'https://t.me/' + botName(env) + '?startapp=r_' + id;
const roomOk = (id) => typeof id === 'string' && /^[a-z0-9]{6,12}$/.test(id);
const isPublic = (id) => /^pub[a-z0-9]{7}$/.test(id);
const newId = () => { const abc = 'abcdefghjkmnpqrstuvwxyz23456789', r = crypto.getRandomValues(new Uint8Array(8)); let s = ''; for (let i = 0; i < 8; i++) s += abc[r[i] % abc.length]; return s; };
const cleanName = (u) => String(u.first_name || u.username || 'Игрок').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 16) || 'Игрок';

// who is asking: Telegram signs the data it hands to a Mini App with the bot's token
async function whoIs(init, env) {
  if (!init || typeof init !== 'string' || init.length > 4096 || !env.BOT_TOKEN) return null;
  const p = new URLSearchParams(init), hash = p.get('hash'); if (!hash) return null;
  const lines = []; for (const [k, v] of p) if (k !== 'hash') lines.push(k + '=' + v); lines.sort();
  const secret = await hmac('WebAppData', env.BOT_TOKEN), sign = hex(await hmac(secret, lines.join('\n')));
  if (!same(sign, hash)) return null;
  const at = parseInt(p.get('auth_date') || '0', 10); if (!(at > 0) || Date.now()/1000 - at > FRESH) return null;
  let u = null; try { u = JSON.parse(p.get('user') || 'null'); } catch (e) {}
  if (!u || !Number.isSafeInteger(u.id)) return null;
  return { id: String(u.id), name: cleanName(u), uz: String(u.language_code || '').toLowerCase().indexOf('uz') === 0 };
}
async function tg(env, method, body) { try { return await (await fetch('https://api.telegram.org/bot' + env.BOT_TOKEN + '/' + method, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json(); } catch (e) { return null; } }

// ---- one room -------------------------------------------------------------
export class Room {
  // An endless arena: it comes to life with the first person in and stops when the last one leaves.
  // People come in at any time and go straight onto the field; after a crash they come back when they like.
  constructor(state, env) { this.state = state; this.env = env; this.socks = new Map(); this.S = null; this.timer = null; this.k = 0; this.acc = 0; this.last = 0; this.away = new Map(); this.dead = new Map(); }
  people() { return [...this.socks.values()].filter((v, i, a) => a.findIndex((w) => w.id === v.id) === i); }
  lobby() { return { t: 'lobby', ph: 'play', players: this.people().map((p) => ({ id: p.id, name: p.name })) }; }
  send(ws, o) { try { ws.send(typeof o === 'string' ? o : JSON.stringify(o)); } catch (e) {} }
  all(o) { const s = typeof o === 'string' ? o : JSON.stringify(o); for (const ws of this.socks.keys()) this.send(ws, s); }
  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('ws only', { status: 426 });
    const id = request.headers.get('X-Uid'); let name = 'Игрок'; try { name = decodeURIComponent(request.headers.get('X-Name') || 'Игрок'); } catch (e) {}
    const back = await this.receipt(id, request.headers.get('X-Resume'));   // checked before the socket opens, so no message is missed
    const pair = new WebSocketPair(), [client, server] = Object.values(pair); server.accept();
    const here = this.people().map((p) => p.id);
    if (!here.includes(id) && here.length >= MAXP) { this.send(server, { t: 'full' }); try { server.close(4002, 'full'); } catch (e) {} return new Response(null, { status: 101, webSocket: client }); }
    // the same person from a second window: the older one goes
    for (const [ws, v] of this.socks) if (v.id === id) { this.send(ws, { t: 'bye', why: 'again' }); try { ws.close(4000, 'again'); } catch (e) {} this.socks.delete(ws); }
    this.socks.set(server, { id, name, seen: Date.now() }); this.sweepOn();
    this.room = request.headers.get('X-Room') || this.room;
    if (!this.S) { this.S = G.newGame(Date.now() & 0x7fffffff); G.fillBots(this.S); this.k = 0; this.acc = 0; this.last = Date.now(); this.run(); }
    // back after a dropped connection: the same snake, handed back from the autopilot. Back into a world that was
    // restarted meanwhile: a new snake with the length the receipt vouches for.
    const had = this.S.sn.some((s) => s.alive && s.id === id); this.away.delete(id);
    G.spawnHuman(this.S, id, name); if (had) G.autopilot(this.S, id, false); else if (back) G.restore(this.S, id, back.L, back.kills);
    this.send(server, { t: 'hello', me: id, kept: had ? 1 : back ? 2 : 0, pub: isPublic(this.room || '') }); this.send(server, { t: 's', s: G.snap(this.S, true) }); this.all(this.lobby()); this.report();
    server.addEventListener('message', (e) => this.onMessage(server, e.data));
    const gone = () => this.leave(server); server.addEventListener('close', gone); server.addEventListener('error', gone);
    return new Response(null, { status: 101, webSocket: client });
  }
  onMessage(ws, data) {
    const me = this.socks.get(ws); if (!me || typeof data !== 'string' || data.length > 300) return; me.seen = Date.now(); let m; try { m = JSON.parse(data); } catch (e) { return; }
    if (m.t === 'in' && this.S && m.c && typeof m.c === 'object') G.input(this.S, me.id, { a: +m.c.a, r: m.c.r === -1 || m.c.r === 1 || m.c.r === 0 ? m.c.r : undefined, b: !!m.c.b });
    else if ((m.t === 'spawn' || m.t === 'start') && this.S) G.spawnHuman(this.S, me.id, me.name);   // back in after a crash
    else if (m.t === 'ping') this.pong(ws, me, +m.k || 0);
    else if (m.t === 'bye') me.bye = true;   // leaving on purpose: no waiting for them to come back
  }
  // a public arena keeps the matchmaker up to date with how many people are in it
  report() { if (!this.room || !isPublic(this.room) || !this.env.LOBBY) return; const n = this.people().length;
    try { this.state.waitUntil(this.env.LOBBY.get(this.env.LOBBY.idFromName('public')).fetch('https://lobby/report', { method: 'POST', body: JSON.stringify({ room: this.room, n }) }).catch(() => {})); } catch (e) {} }
  // every couple of seconds each phone gets a signed receipt of what its snake has; it shows it if it has to come back
  async pong(ws, me, k) { let tok; const s = this.S && this.S.sn.find((v) => v.alive && v.id === me.id);
    if (s && this.env.BOT_TOKEN) { const body = [me.id, Math.floor(s.L), s.kills | 0, Math.floor(Date.now()/1000)].join('.'); tok = body + '.' + hex(await hmac(this.env.BOT_TOKEN + ':receipt', body)); }
    this.send(ws, { t: 'pong', k, tok }); }
  async receipt(id, tok) { if (!tok || typeof tok !== 'string' || tok.length > 200 || !this.env.BOT_TOKEN) return null; const p = tok.split('.'); if (p.length !== 5 || p[0] !== id) return null;
    const ts = +p[3]; if (!(Date.now()/1000 - ts < 120) || (this.dead.get(id) || 0) >= ts*1000) return null;   // too old, or that snake has crashed since
    if (!same(hex(await hmac(this.env.BOT_TOKEN + ':receipt', p.slice(0, 4).join('.'))), p[4])) return null; return { L: +p[1], kills: +p[2] }; }
  // a dropped connection is not a crash: the snake stays for a while on autopilot, and its owner gets it back
  leave(ws) { const me = this.socks.get(ws); if (!me) return; this.socks.delete(ws); this.report();
    if (this.S && !this.people().some((p) => p.id === me.id)) { if (me.bye) G.removeHuman(this.S, me.id); else if (G.autopilot(this.S, me.id, true)) this.away.set(me.id, Date.now()); }
    if (this.socks.size) this.all(this.lobby()); else if (!this.away.size) this.shut(); }
  shut() { this.stop(); this.S = null; this.away.clear(); if (this.sweeper) { clearInterval(this.sweeper); this.sweeper = null; } }
  // a phone that has gone quiet for 45 s is gone, even if its connection never said so (phones ping every 2 s)
  sweepOn() { if (this.sweeper) return; this.sweeper = setInterval(() => { const t = Date.now(); for (const [ws, v] of this.socks) if (t - v.seen > 45000) { try { ws.close(4001, 'quiet'); } catch (e) {} this.leave(ws); } }, 10000); }
  run() { if (this.timer) return; this.timer = setInterval(() => this.tick(), TICK); }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  tick() {
    const S = this.S; if (!S) return this.stop();
    // real time, whatever the timer does: catch up by whole ticks, every one of them sent, since phones rebuild bodies from them
    const t = Date.now(); this.acc += Math.min(500, t - this.last); this.last = t;
    let n = 0; while (this.acc >= TICK && n++ < 6) { this.acc -= TICK; G.step(S); this.k++; this.all({ t: 's', s: G.snap(S, this.k % 200 === 0) }); if (this.k % 600 === 0) this.report();
      for (const e of S.ev) if (e.t === 'die' && S.sn[e.i] && !S.sn[e.i].bot) this.dead.set(S.sn[e.i].id, Date.now()); }
    // people who dropped and did not come back within 12 s: their snake goes; an arena nobody is coming back to closes
    if (this.k % 20 === 0 && this.away.size) { for (const [id, at] of this.away) if (t - at > 12000 || !S.sn.some((s) => s.alive && s.id === id)) { G.removeHuman(S, id); this.away.delete(id); } if (!this.socks.size && !this.away.size) this.shut(); }
  }
}

// ---- the matchmaker ---------------------------------------------------------
// One for the whole game. It knows the public arenas and how many people each holds, and sends a newcomer
// to the fullest one that still has room, so people meet people; when all are full it opens a new one.
export class Lobby {
  constructor(state, env) { this.rooms = new Map(); }   // room -> { n, t }
  async fetch(request) {
    const url = new URL(request.url), now = Date.now(); let b = {}; try { b = await request.json(); } catch (e) {}
    for (const [id, r] of this.rooms) if (now - r.t > 90000 || (r.n <= 0 && now - r.t > 15000)) this.rooms.delete(id);
    if (url.pathname === '/report') { if (isPublic(String(b.room || ''))) this.rooms.set(b.room, { n: Math.max(0, b.n | 0), t: now }); return json({ ok: true }); }
    if (url.pathname === '/pick') {
      let best = null; for (const [id, r] of this.rooms) if (r.n < MAXP && r.n > 0 && (!best || r.n > best.r.n)) best = { id, r };
      if (!best) { const id = 'pub' + newId().slice(0, 7); this.rooms.set(id, { n: 1, t: now }); return json({ ok: true, room: id, fresh: true }); }
      best.r.n++; best.r.t = now; return json({ ok: true, room: best.id });   // count them in now, so a crowd arriving together spreads out right
    }
    if (url.pathname === '/stats') return json({ ok: true, arenas: [...this.rooms].map(([id, r]) => ({ id, people: r.n })) });
    return json({ ok: false }, 404);
  }
}

// ---- the bot --------------------------------------------------------------
async function telegram(env, request) {
  if (!env.HOOK_SECRET || request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.HOOK_SECRET) return new Response('no', { status: 403 });
  let up = null; try { up = await request.json(); } catch (e) { return new Response('ok'); }
  const m = up && up.message; if (!m || !m.chat || typeof m.text !== 'string') return new Response('ok');
  const cmd = m.text.trim().split(/[\s@]/)[0].toLowerCase(), uz = String(m.from && m.from.language_code || '').toLowerCase().indexOf('uz') === 0;
  if (cmd === '/game' || cmd === '/play' || (cmd === '/start' && m.chat.type !== 'private')) {
    // one room for the whole chat: the button takes everyone to the same arena
    const id = newId(), who = m.from ? cleanName(m.from) : '';
    await tg(env, 'sendMessage', { chat_id: m.chat.id, text: uz ? '🐍 ' + who + ' neon ilonlar arenasiga chaqiryapti! Istalgan payt kiring.' : '🐍 ' + who + ' зовёт на арену Неон Змеек! Заходи в любой момент — арена работает без перерывов.', reply_markup: { inline_keyboard: [[{ text: uz ? '🎮 Arenaga kirish' : '🎮 На арену', url: link(env, id) }]] } });
  } else if (cmd === '/start' || cmd === '/help') {
    await tg(env, 'sendMessage', { chat_id: m.chat.id, text: uz ? 'Chiroqlarni yeng, o‘sing va boshqalarni dumingizga urilishga majbur qiling! Do‘stlar bilan: guruhga qo‘shing va /game yozing.' : 'Ешь огоньки, расти и заставляй других врезаться в твой хвост. Последний живой — победитель.\n\nС друзьями: добавь меня в группу и напиши /game.', reply_markup: { inline_keyboard: [[{ text: uz ? '🐍 O‘ynash' : '🐍 Играть', url: 'https://t.me/' + botName(env) + '?startapp=home' }]] } });
  }
  return new Response('ok');
}
async function setup(env, origin) {
  const hook = await tg(env, 'setWebhook', { url: origin + '/tg', secret_token: env.HOOK_SECRET, allowed_updates: ['message'] });
  const cmds = await tg(env, 'setMyCommands', { commands: [{ command: 'game', description: 'Позвать всех на арену' }, { command: 'help', description: 'Как играть' }] });
  return { webhook: !!(hook && hook.ok), commands: !!(cmds && cmds.ok) };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url), path = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      if (path === '/ws') {
        const room = url.searchParams.get('room'), me = await whoIs(url.searchParams.get('init'), env);
        if (!roomOk(room)) return json({ ok: false, err: 'room' }, 400); if (!me) return json({ ok: false, err: 'auth' }, 401);
        const h = new Headers(request.headers); h.set('X-Uid', me.id); h.set('X-Name', encodeURIComponent(me.name)); h.set('X-Room', room); const res = url.searchParams.get('res'); if (res && res.length < 200) h.set('X-Resume', res); else h.delete('X-Resume');
        return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(new Request(request.url, { headers: h }));
      }
      if (path === '/play' && request.method === 'POST') { let q = {}; try { q = await request.json(); } catch (e) {} const me = await whoIs(q && q.init, env); if (!me) return json({ ok: false, err: 'auth' }, 401);
        if (!env.LOBBY) return json({ ok: false, err: 'lobby' }, 503);
        return env.LOBBY.get(env.LOBBY.idFromName('public')).fetch('https://lobby/pick', { method: 'POST', body: '{}' }); }
      if (path === '/arenas') return env.LOBBY ? env.LOBBY.get(env.LOBBY.idFromName('public')).fetch('https://lobby/stats', { method: 'POST', body: '{}' }) : json({ ok: false });
      if (path === '/new' && request.method === 'POST') { let q = {}; try { q = await request.json(); } catch (e) {} const me = await whoIs(q && q.init, env); if (!me) return json({ ok: false, err: 'auth' }, 401); const id = newId(); return json({ ok: true, id, link: link(env, id) }); }
      if (path === '/share' && request.method === 'POST') { let q = {}; try { q = await request.json(); } catch (e) {} const me = await whoIs(q && q.init, env), room = String((q && q.room) || ''); if (!me) return json({ ok: false, err: 'auth' }, 401); if (!roomOk(room)) return json({ ok: false, err: 'room' }, 400);
        const r = await tg(env, 'savePreparedInlineMessage', { user_id: Number(me.id), allow_user_chats: true, allow_group_chats: true, result: { type: 'article', id: 'r' + room, title: 'Неон Змейки', description: me.uz ? 'Arenaga taklif' : 'Приглашение на арену', input_message_content: { message_text: me.uz ? '🐍 ' + me.name + ' neon ilonlar jangiga chaqiryapti! 👇' : '🐍 ' + me.name + ' зовёт на арену Неон Змеек! Заходи 👇' }, reply_markup: { inline_keyboard: [[{ text: me.uz ? '🎮 Arenaga kirish' : '🎮 На арену', url: link(env, room) }]] } } });
        return r && r.ok ? json({ ok: true, id: r.result.id }) : json({ ok: false, err: (r && r.description) || 'tg' }, 502); }
      if (path === '/tg' && request.method === 'POST') return await telegram(env, request);
      if (path === '/setup') { if (!env.HOOK_SECRET || url.searchParams.get('key') !== env.HOOK_SECRET) return json({ ok: false, err: 'key' }, 403); return json(Object.assign({ ok: true }, await setup(env, url.origin))); }
      if (path === '/' || path === '/health') return json({ ok: true, name: 'Neon Snakes', rooms: !!env.ROOMS, lobby: !!env.LOBBY, token: !!env.BOT_TOKEN, key: !!env.HOOK_SECRET });
      return json({ ok: false, err: 'path' }, 404);
    } catch (e) { return json({ ok: false, err: 'server', msg: String(e && e.message || e).slice(0, 200) }, 500); }
  },
};
