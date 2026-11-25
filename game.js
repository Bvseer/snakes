// Neon snakes: drawing, controls, menus and the connection to a room. The rules live in sim.js.
import * as THREE from 'three';
import * as G from './sim.js';

const API = 'https://snakes.basirxujamuradov.workers.dev', BOT = 'NeonSnakesGameBot';
const $ = (id) => document.getElementById(id);
const TG = window.Telegram && Telegram.WebApp && Telegram.WebApp.initData ? Telegram.WebApp : null;
const zt = () => window.ZT || {}, initStr = () => zt().init || (TG ? TG.initData : '');
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const esc = (s) => String(s).replace(/[<>&"]/g, '');
const haptic = (k) => { try { TG && TG.HapticFeedback && TG.HapticFeedback.impactOccurred(k || 'light'); } catch (e) {} };

// ---- renderer --------------------------------------------------------------
const canvas = $('gl');
const R = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
R.setClearColor(0x04050c); R.outputColorSpace = THREE.SRGBColorSpace;
let DPR = Math.min(window.devicePixelRatio || 1, 2); R.setPixelRatio(DPR);
const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x04050c, 70, 150);
const cam = new THREE.PerspectiveCamera(50, 1, 0.5, 400);
function resize() { const w = innerWidth, h = innerHeight; R.setSize(w, h, false); cam.aspect = w/h; cam.fov = w < h ? 64 : 48; cam.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
const U = { time: { value: 0 } };

// the floor: a grid that glows under every head, a ring where the arena ends
const HEADS = 6;
const floorMat = new THREE.ShaderMaterial({
  uniforms: { uTime: U.time, uR: { value: G.R0 }, uWarn: { value: 0 }, uHeads: { value: Array.from({ length: HEADS }, () => new THREE.Vector3()) }, uCols: { value: Array.from({ length: HEADS }, () => new THREE.Color()) } },
  vertexShader: `varying vec2 vP; void main(){ vec4 w = modelMatrix*vec4(position,1.); vP = w.xz; gl_Position = projectionMatrix*viewMatrix*w; }`,
  fragmentShader: `uniform float uTime, uR, uWarn; uniform vec3 uHeads[${HEADS}]; uniform vec3 uCols[${HEADS}]; varying vec2 vP;
    float line(vec2 p, float s){ vec2 q = p/s; vec2 g = abs(fract(q-.5)-.5)/fwidth(q); return 1.-min(min(g.x,g.y),1.); }
    void main(){
      float d = length(vP), inside = smoothstep(uR+.25, uR-.25, d);
      vec3 ringC = mix(vec3(0.,.94,1.), vec3(1.,.17,.5), uWarn);
      vec3 c = vec3(.015,.02,.05);
      float g = line(vP, 2.)*.13 + line(vP, 10.)*.3;
      c += mix(vec3(.5,.05,.12)*.5, vec3(0.,.55,.8), inside)*g*(inside*.9+.25);
      c += vec3(.0,.02,.05)*inside;
      for (int i=0;i<${HEADS};i++){ vec2 dp = vP-uHeads[i].xy; c += uCols[i]*uHeads[i].z*(.55/(1.+dot(dp,dp)*.18) + g*2.2/(1.+dot(dp,dp)*.08)); }
      float ring = exp(-abs(d-uR)*2.2);
      c += ringC*ring*(.9+.25*sin(uTime*4.));
      c *= 1.-smoothstep(uR+8., uR+45., d)*.85;
      gl_FragColor = vec4(c,1.);
    }`,
});
const floor = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), floorMat); floor.rotation.x = -Math.PI/2; scene.add(floor);

// the wall of light around the arena
const wallMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  uniforms: { uTime: U.time, uWarn: { value: 0 } },
  vertexShader: `varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform float uTime, uWarn; varying vec2 vU; void main(){ float a = pow(1.-vU.y, 2.2)*.75; a *= .75+.25*sin(vU.x*300.-uTime*3.); vec3 c = mix(vec3(0.,.94,1.), vec3(1.,.17,.5), uWarn); gl_FragColor = vec4(c*a, 1.); }` });
const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 2.2, 160, 1, true), wallMat); wall.position.y = 1.1; scene.add(wall);

// ---- snakes: a lit neon tube each, built fresh from the body points every frame ----
const MAXPT = 720, RING = 10;
const tubeVS = `attribute float aU; varying vec3 vN, vV, vW; varying float vU;
  void main(){ vU = aU; vW = normal; vec4 mv = modelViewMatrix*vec4(position,1.); vN = normalMatrix*normal; vV = -mv.xyz; gl_Position = projectionMatrix*mv; }`;
const tubeFS = `uniform vec3 uCol; uniform float uTime, uBoost, uFade; varying vec3 vN, vV, vW; varying float vU;
  void main(){
    float f = 1.-abs(dot(normalize(vN), normalize(vV)));
    float stripe = smoothstep(.35,.65,.5+.5*sin(vU*1.3 - uTime*(2.5+uBoost*14.)));
    vec3 c = uCol*(.6+.25*stripe+uBoost*.25);
    c += vec3(1.)*pow(1.-f,3.)*(.38+.2*stripe);
    c += uCol*pow(f,2.)*.9;
    c += vec3(1.)*pow(max(vW.y,0.),12.)*.25;
    gl_FragColor = vec4(c*uFade, 1.);
  }`;
function tubeIndex() { const idx = []; for (let i = 0; i < MAXPT - 1; i++) for (let k = 0; k < RING; k++) { const a = i*RING + k, b = i*RING + (k + 1)%RING, c = a + RING, d = b + RING; idx.push(a, b, c, b, d, c); } return idx; }
const IDX = tubeIndex();
const eyeW = new THREE.MeshBasicMaterial({ color: 0xffffff }), eyeB = new THREE.MeshBasicMaterial({ color: 0x05060d });
const eyeG = new THREE.SphereGeometry(1, 12, 8);
function label(text, col) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const x = c.getContext('2d');
  x.font = '800 30px Manrope, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.shadowColor = hex(col); x.shadowBlur = 12; x.fillStyle = '#fff'; x.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false })); s.scale.set(5.2, 1.3, 1); s.renderOrder = 5; return s;
}
const VIS = [];
function vis(i) {
  if (VIS[i]) return VIS[i];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXPT*RING*3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(MAXPT*RING*3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aU', new THREE.BufferAttribute(new Float32Array(MAXPT*RING), 1).setUsage(THREE.DynamicDrawUsage));
  g.setIndex(IDX); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  const mat = new THREE.ShaderMaterial({ uniforms: { uCol: { value: new THREE.Color() }, uTime: U.time, uBoost: { value: 0 }, uFade: { value: 1 } }, vertexShader: tubeVS, fragmentShader: tubeFS });
  const body = new THREE.Mesh(g, mat); body.frustumCulled = false;
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), mat);
  const eyes = []; for (let k = 0; k < 2; k++) { const w = new THREE.Mesh(eyeG, eyeW), p = new THREE.Mesh(eyeG, eyeB); scene.add(w, p); eyes.push([w, p]); }
  scene.add(body, head);
  return VIS[i] = { body, head, eyes, mat, g, tag: null, tagName: '' };
}

// glow: soft additive dots along every body and around every light on the floor
const GLOWN = 1400;
const glowG = new THREE.BufferGeometry();
glowG.setAttribute('position', new THREE.BufferAttribute(new Float32Array(GLOWN*3), 3).setUsage(THREE.DynamicDrawUsage));
glowG.setAttribute('color', new THREE.BufferAttribute(new Float32Array(GLOWN*3), 3).setUsage(THREE.DynamicDrawUsage));
glowG.setAttribute('size', new THREE.BufferAttribute(new Float32Array(GLOWN), 1).setUsage(THREE.DynamicDrawUsage));
const pointVS = `attribute float size; attribute vec3 color; varying vec3 vC; uniform float uScale;
  void main(){ vC = color; vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = size*uScale/-mv.z; gl_Position = projectionMatrix*mv; }`;
const SCALE = { value: 1 };
const glowMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uScale: SCALE },
  vertexShader: pointVS, fragmentShader: `varying vec3 vC; void main(){ vec2 p = gl_PointCoord-.5; float a = exp(-dot(p,p)*18.)*.32; gl_FragColor = vec4(vC*a,1.); }` });
const glow = new THREE.Points(glowG, glowMat); glow.frustumCulled = false; scene.add(glow);

// food: a bright core inside a soft halo, each light breathing on its own beat
const FOODN = 900;
const foodG = new THREE.BufferGeometry();
foodG.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FOODN*3), 3).setUsage(THREE.DynamicDrawUsage));
foodG.setAttribute('color', new THREE.BufferAttribute(new Float32Array(FOODN*3), 3).setUsage(THREE.DynamicDrawUsage));
foodG.setAttribute('size', new THREE.BufferAttribute(new Float32Array(FOODN), 1).setUsage(THREE.DynamicDrawUsage));
const foodMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uScale: SCALE, uTime: U.time },
  vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; uniform float uScale, uTime;
    void main(){ vC = color; vec4 mv = modelViewMatrix*vec4(position,1.); float b = .85+.15*sin(uTime*3.+position.x*1.7+position.z*1.3); gl_PointSize = size*b*uScale/-mv.z; gl_Position = projectionMatrix*mv; }`,
  fragmentShader: `varying vec3 vC; void main(){ vec2 p = gl_PointCoord-.5; float d = length(p); float core = smoothstep(.13,.07,d); float a = exp(-d*d*22.)*.75; gl_FragColor = vec4(mix(vC*a, vec3(1.), core*.8),1.); }` });
const foodPts = new THREE.Points(foodG, foodMat); foodPts.frustumCulled = false; scene.add(foodPts);

// sparks: bursts when a snake dies, a trail when one dashes
const SPN = 700, SP = [];
const spG = new THREE.BufferGeometry();
spG.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPN*3), 3).setUsage(THREE.DynamicDrawUsage));
spG.setAttribute('color', new THREE.BufferAttribute(new Float32Array(SPN*3), 3).setUsage(THREE.DynamicDrawUsage));
spG.setAttribute('size', new THREE.BufferAttribute(new Float32Array(SPN), 1).setUsage(THREE.DynamicDrawUsage));
const spMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uScale: SCALE },
  vertexShader: pointVS, fragmentShader: `varying vec3 vC; void main(){ vec2 p = gl_PointCoord-.5; float d = length(p); float a = smoothstep(.5,.0,d); gl_FragColor = vec4(vC*a*a*1.4,1.); }` });
const spPts = new THREE.Points(spG, spMat); spPts.frustumCulled = false; scene.add(spPts);
function spark(x, y, z, vx, vy, vz, col, life, size) { if (SP.length >= SPN) SP.shift(); SP.push({ x, y, z, vx, vy, vz, c: new THREE.Color(col), life, max: life, size }); }
function burst(x, z, col, n) { for (let k = 0; k < n; k++) { const a = Math.random()*Math.PI*2, v = 3 + Math.random()*12, up = 2 + Math.random()*8; spark(x, 0.6, z, Math.cos(a)*v, up, Math.sin(a)*v, col, 0.6 + Math.random()*0.8, 0.5 + Math.random()*0.9); } }

// ---- sound: a few synth blips, nothing to download ----
let AC = null;
function beep(f, d, type, vol, slide) { try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain(); o.type = type || 'sine'; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d); g.gain.setValueAtTime(vol || 0.08, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.connect(g).connect(AC.destination); o.start(t); o.stop(t + d); } catch (e) {} }
let eatT = 0;

// ---- the game being shown --------------------------------------------------
let MODE = 'demo', LS = null, M = G.mirror(), snapAt = 0, ME = null, NET = null, acc = 0, overShown = false, lastCount = 99;
function applySnap(o) {
  const evs = G.apply(M, o); snapAt = performance.now();
  for (const e of evs) onEvent(e);
  if (M.ph === 'over' && MODE !== 'demo' && !overShown) { overShown = true; setTimeout(showOver, 1300); }
  if (M.ph === 'play' && o.full && o.tm <= 0) { overShown = false; show(null); $('hud').classList.toggle('on', MODE !== 'demo'); }
}
function newLocal(withMe) {
  LS = G.newGame((Math.random()*1e9) | 0); if (withMe) G.addSnake(LS, 'me', 'Ты', false); G.fillBots(LS); if (!withMe) LS.tm = 0;
  M = G.mirror(); ME = withMe ? 'me' : null; acc = 0; $('feed').innerHTML = ''; lastCount = 99; applySnap(G.snap(LS, true));
}
const meS = () => M.sn.find((s) => s.id === ME);
function nameOf(s) { return s.id === ME ? 'Ты' : s.name; }
function onEvent(e) {
  if (e.t === 'die') { const s = M.sn[e.i]; if (!s) return; const col = G.COLORS[s.col % G.COLORS.length]; burst(e.x, e.z, col, 70);
    const by = e.by >= 0 ? M.sn[e.by] : null;
    if (MODE !== 'demo') { feed(by ? nameOf(by) + ' → ' + nameOf(s) : nameOf(s) + ' разбил' + (s.id === ME ? 'ся' : 'ся') + ' о стену', s.id === ME || (by && by.id === ME));
      const me = meS(); const dist = me ? Math.hypot(me.x - e.x, me.z - e.z) : 99;
      if (s.id === ME) { big('Ты разбился!<small>' + (by ? 'врезался в ' + esc(by.name) : 'стена арены') + '</small>', 2200); haptic('heavy'); beep(180, 0.5, 'sawtooth', 0.12, 40); }
      else if (by && by.id === ME) { big('Есть!<small>' + esc(s.name) + ' врезался в тебя</small>', 1500); haptic('medium'); beep(520, 0.25, 'square', 0.07, 1040); }
      else if (dist < 30) beep(260, 0.3, 'triangle', 0.06, 90); } }
  else if (e.t === 'eat' && MODE !== 'demo') { const s = M.sn[e.i]; if (s && s.id === ME && performance.now() - eatT > 70) { eatT = performance.now(); beep(700 + Math.random()*300, 0.08, 'sine', 0.05, 1400); } }
}

// ---- drawing a frame -------------------------------------------------------
const tmpC = new THREE.Color();
function buildTube(v, s, hx, hz, r, fade) {
  const P = v.g.attributes.position.array, N = v.g.attributes.normal.array, A = v.g.attributes.aU.array;
  const fx = Math.cos(s.a), fz = Math.sin(s.a);
  const pts = [[hx, hz]];
  for (const p of s.tr) { if ((p[0] - hx)*fx + (p[1] - hz)*fz > -0.1 && pts.length === 1) continue; pts.push(p); if (pts.length >= MAXPT) break; }
  const n = pts.length, tailFrom = Math.max(4, Math.floor(n*0.7));
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]; let tx = a[0] - b[0], tz = a[1] - b[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const sx = -tz, sz = tx, rr = r*(i < tailFrom ? 1 : 0.3 + 0.7*(n - 1 - i)/Math.max(1, n - 1 - tailFrom)), cy = r*0.95, p = pts[i];
    for (let k = 0; k < RING; k++) { const th = k/RING*Math.PI*2, c = Math.cos(th), sn = Math.sin(th), nx = sx*c, ny = sn, nz = sz*c, o = (i*RING + k)*3;
      P[o] = p[0] + nx*rr; P[o + 1] = cy + ny*rr; P[o + 2] = p[1] + nz*rr; N[o] = nx; N[o + 1] = ny; N[o + 2] = nz; A[i*RING + k] = i*0.5; }
  }
  v.g.setDrawRange(0, Math.max(0, n - 1)*RING*6);
  v.g.attributes.position.needsUpdate = v.g.attributes.normal.needsUpdate = v.g.attributes.aU.needsUpdate = true;
  v.g.attributes.position.updateRange = undefined;
  return pts;
}
let gi = 0; const GP = glowG.attributes.position.array, GC = glowG.attributes.color.array, GS = glowG.attributes.size.array;
function glowAt(x, y, z, col, size) { if (gi >= GLOWN) return; GP[gi*3] = x; GP[gi*3 + 1] = y; GP[gi*3 + 2] = z; GC[gi*3] = col.r; GC[gi*3 + 1] = col.g; GC[gi*3 + 2] = col.b; GS[gi] = size; gi++; }

const camT = new THREE.Vector3(0, 0, 0), camP = new THREE.Vector3(0, 60, 40); let camH = 30, follow = -1;
function drawWorld(dt) {
  const t = performance.now(), al = Math.min(1, (t - snapAt)/50);
  floorMat.uniforms.uR.value = M.R; wall.scale.set(M.R, 1, M.R);
  const warn = M.tm > G.SHRINK - 3 && M.R > G.RMIN + 0.01 ? 1 : 0; floorMat.uniforms.uWarn.value += (warn - floorMat.uniforms.uWarn.value)*Math.min(1, dt*3); wallMat.uniforms.uWarn.value = floorMat.uniforms.uWarn.value;
  gi = 0; const heads = floorMat.uniforms.uHeads.value, hcols = floorMat.uniforms.uCols.value;
  for (let i = 0; i < HEADS; i++) heads[i].z = 0;
  M.sn.forEach((s, i) => {
    const v = vis(i), col = G.COLORS[s.col % G.COLORS.length]; v.mat.uniforms.uCol.value.setHex(col);
    const show = s.alive || false; v.body.visible = v.head.visible = show; for (const e of v.eyes) e[0].visible = e[1].visible = show;
    if (v.tag) v.tag.visible = false;
    if (!show) return;
    const hx = s.px + (s.x - s.px)*al, hz = s.pz + (s.z - s.pz)*al, r = G.radius(s.L);
    v.mat.uniforms.uBoost.value += ((s.boosting ? 1 : 0) - v.mat.uniforms.uBoost.value)*Math.min(1, dt*8);
    const pts = buildTube(v, s, hx, hz, r);
    const hr = r*1.18; v.head.position.set(hx, r*0.95, hz); v.head.scale.setScalar(hr);
    const fx = Math.cos(s.a), fz = Math.sin(s.a), sx = -fz, sz = fx;
    v.eyes.forEach(([w, p], k) => { const side = k ? 1 : -1, ex = hx + fx*hr*0.45 + sx*side*hr*0.5, ez = hz + fz*hr*0.45 + sz*side*hr*0.5, ey = r*0.95 + hr*0.55;
      w.position.set(ex, ey, ez); w.scale.setScalar(hr*0.34); p.position.set(ex + fx*hr*0.17, ey + hr*0.08, ez + fz*hr*0.17); p.scale.setScalar(hr*0.19); });
    tmpC.setHex(col);
    for (let k = 0; k < pts.length; k += 3) glowAt(pts[k][0], 0.3, pts[k][1], tmpC, r*9*(1 - k/pts.length*0.5));
    glowAt(hx, 0.5, hz, tmpC, r*16);
    if (s.boosting && Math.random() < 0.7) { const tp = pts[pts.length - 1]; spark(tp[0], r, tp[1], (Math.random() - 0.5)*3, 1 + Math.random()*2, (Math.random() - 0.5)*3, col, 0.5, 0.45); }
    if (i < HEADS) { heads[i].set(hx, hz, s.boosting ? 1.4 : 1); hcols[i].setHex(col); }
    if (MODE !== 'demo' && s.id !== ME) { if (!v.tag || v.tagName !== s.name) { if (v.tag) scene.remove(v.tag); v.tag = label(s.name, col); v.tagName = s.name; scene.add(v.tag); } v.tag.visible = true; v.tag.position.set(hx, r*2 + 2.2, hz); }
  });
  for (let i = M.sn.length; i < VIS.length; i++) { const v = VIS[i]; if (!v) continue; v.body.visible = v.head.visible = false; for (const e of v.eyes) e[0].visible = e[1].visible = false; if (v.tag) v.tag.visible = false; }
  glowG.setDrawRange(0, gi); glowG.attributes.position.needsUpdate = glowG.attributes.color.needsUpdate = glowG.attributes.size.needsUpdate = true;

  // food
  if (M.food.size !== foodN || foodDirty !== M.food) { foodDirty = M.food; }
  let fi = 0; const FP = foodG.attributes.position.array, FC = foodG.attributes.color.array, FS = foodG.attributes.size.array;
  for (const [id, f] of M.food) { if (fi >= FOODN) break; FP[fi*3] = f[0]; FP[fi*3 + 1] = 0.35 + f[2]*0.12; FP[fi*3 + 2] = f[1]; tmpC.setHex(G.COLORS[id % G.COLORS.length]); FC[fi*3] = tmpC.r; FC[fi*3 + 1] = tmpC.g; FC[fi*3 + 2] = tmpC.b; FS[fi] = 2.2 + f[2]*1.6; fi++; }
  foodN = fi; foodG.setDrawRange(0, fi); foodG.attributes.position.needsUpdate = foodG.attributes.color.needsUpdate = foodG.attributes.size.needsUpdate = true;

  // sparks
  const SPp = spG.attributes.position.array, SPc = spG.attributes.color.array, SPs = spG.attributes.size.array; let si = 0;
  for (let k = SP.length - 1; k >= 0; k--) { const p = SP[k]; p.life -= dt; if (p.life <= 0) { SP.splice(k, 1); continue; } p.vy -= 18*dt; p.x += p.vx*dt; p.y = Math.max(0.1, p.y + p.vy*dt); p.z += p.vz*dt; p.vx *= 0.97; p.vz *= 0.97;
    const f = p.life/p.max; SPp[si*3] = p.x; SPp[si*3 + 1] = p.y; SPp[si*3 + 2] = p.z; SPc[si*3] = p.c.r*f; SPc[si*3 + 1] = p.c.g*f; SPc[si*3 + 2] = p.c.b*f; SPs[si] = p.size; si++; }
  spG.setDrawRange(0, si); spG.attributes.position.needsUpdate = spG.attributes.color.needsUpdate = spG.attributes.size.needsUpdate = true;

  // the camera follows you; once you are out, whoever is longest
  const me = meS(); let tgt = me && me.alive ? me : null;
  if (!tgt) { const alive = M.sn.filter((s) => s.alive).sort((a, b) => b.L - a.L); tgt = alive.find((s) => s.i === follow) || alive[0]; }
  if (tgt) { follow = tgt.i; const hx = tgt.px + (tgt.x - tgt.px)*al, hz = tgt.pz + (tgt.z - tgt.pz)*al; camT.lerp(new THREE.Vector3(hx, 0, hz), 1 - Math.exp(-dt*(MODE === 'demo' ? 1.5 : 9)));
    const want = (MODE === 'demo' ? 40 : 21) + Math.min(20, tgt.L*0.06); camH += (want - camH)*Math.min(1, dt*2); }
  camP.set(camT.x, camH, camT.z + camH*0.5); cam.position.copy(camP); cam.lookAt(camT.x, 0, camT.z - 2);
  SCALE.value = innerHeight*DPR/(2*Math.tan(cam.fov*Math.PI/360));
}
let foodN = 0, foodDirty = null;

// ---- hud ---------------------------------------------------------------
let hudT = 0;
const mini = $('mini').getContext('2d');
function hud(dt) {
  hudT -= dt; if (hudT > 0 || MODE === 'demo') return; hudT = 0.2;
  if (M.tm <= 0 && M.ph === 'play') { const n = Math.ceil(-M.tm); if (n !== lastCount && n >= 1) { lastCount = n; big(String(n), 700); beep(440, 0.12, 'square', 0.06); } }
  else if (lastCount !== 0 && M.ph === 'play') { lastCount = 0; big('ВПЕРЁД!', 800); beep(880, 0.25, 'square', 0.07); haptic('medium'); }
  const left = Math.max(0, G.ROUND - Math.max(0, M.tm)); $('hTime').textContent = Math.floor(left/60) + ':' + String(Math.floor(left%60)).padStart(2, '0');
  $('hTime').style.color = left < 15 ? '#ff6b8b' : '';
  const alive = M.sn.filter((s) => s.alive); $('hAlive').textContent = '🐍 ' + alive.length + ' / ' + M.sn.length;
  const me = meS(); $('hLen').textContent = me ? (me.alive ? '📏 ' + Math.floor(me.L) : '👀 смотришь') : '';
  const rows = M.sn.slice().sort((a, b) => (b.alive - a.alive) || b.L - a.L);
  $('board').innerHTML = rows.map((s) => '<div class="' + (s.id === ME ? 'me ' : '') + (s.alive ? '' : 'dead') + '">' + esc(nameOf(s)) + ' ' + Math.floor(s.L) + '<i style="color:' + hex(G.COLORS[s.col % G.COLORS.length]) + '"></i></div>').join('');
  // minimap
  const W = 184, k = W/2/(G.R0 + 2); mini.clearRect(0, 0, W, W); mini.save(); mini.translate(W/2, W/2);
  mini.strokeStyle = floorMat.uniforms.uWarn.value > 0.5 ? '#ff2b80' : '#00f0ff'; mini.lineWidth = 2; mini.beginPath(); mini.arc(0, 0, M.R*k, 0, Math.PI*2); mini.stroke();
  for (const s of M.sn) { if (!s.alive) continue; mini.fillStyle = hex(G.COLORS[s.col % G.COLORS.length]); const big = s.id === ME; mini.beginPath(); mini.arc(s.x*k, s.z*k, big ? 6 : 3.5 + Math.min(3, s.L/80), 0, Math.PI*2); mini.fill(); if (big) { mini.strokeStyle = '#fff'; mini.lineWidth = 2; mini.stroke(); } }
  mini.restore();
}
function feed(text, mine) { const d = document.createElement('div'); d.textContent = text; if (mine) d.style.border = '1px solid #00f0ff'; $('feed').prepend(d); while ($('feed').children.length > 4) $('feed').lastChild.remove(); setTimeout(() => d.remove(), 3300); }
let bigT = 0; function big(html, ms) { const e = $('big'); e.innerHTML = html; e.classList.add('on'); clearTimeout(bigT); bigT = setTimeout(() => e.classList.remove('on'), ms || 1500); }
let toastT = 0; function toast(t, ms) { const e = $('toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => e.classList.remove('on'), ms || 2000); }
function show(id) { for (const s of ['home', 'help', 'lobby', 'over']) $(s).classList.toggle('hidden', s !== id); }
function showOver() {
  if (M.ph !== 'over' || !M.res) return; $('hud').classList.remove('on'); $('big').classList.remove('on'); show('over');
  const mine = M.res.find((r) => r.id === ME), place = mine ? mine.place : 0;
  $('oTitle').innerHTML = place === 1 ? '🏆 ПОБЕДА!' : place ? place + ' МЕСТО' : 'РАУНД ОКОНЧЕН';
  $('res').innerHTML = M.res.map((r) => '<div class="' + (r.id === ME ? 'me' : '') + '"><span class="p">' + r.place + '</span><i style="color:' + hex(G.COLORS[(M.sn[r.i] || {}).col % G.COLORS.length || 0]) + '"></i><span class="n">' + esc(r.id === ME ? 'Ты' : r.name) + '</span><span class="s">📏 ' + r.L + (r.kills ? ' · 💥 ' + r.kills : '') + '</span></div>').join('');
  if (place === 1) haptic('heavy');
}

// ---- controls: drag anywhere to steer, a second finger or the button to dash ----
let aim = null, boost = false, steerId = null, boostId = null, ox = 0, oy = 0, keyTurn = 0, sentA = 99, sentB = false, sentT = 0;
const stick = $('stick'), knob = stick.firstElementChild;
function onDown(e) {
  if (MODE === 'demo' || e.target.closest('button') || e.target.id === 'boost') return;
  if (e.pointerType === 'mouse') { boost = true; aimFromMouse(e); return; }
  if (steerId === null) { steerId = e.pointerId; ox = e.clientX; oy = e.clientY; stick.style.left = ox + 'px'; stick.style.top = oy + 'px'; stick.style.display = 'block'; knob.style.transform = ''; }
  else if (boostId === null) { boostId = e.pointerId; boost = true; }
}
function aimFromMouse(e) { const dx = e.clientX - innerWidth/2, dy = e.clientY - innerHeight/2; if (dx*dx + dy*dy > 100) aim = Math.atan2(dy, dx); }
function onMove(e) {
  if (MODE === 'demo') return;
  if (e.pointerType === 'mouse') { aimFromMouse(e); return; }
  if (e.pointerId !== steerId) return; const dx = e.clientX - ox, dy = e.clientY - oy, d = Math.hypot(dx, dy);
  if (d > 8) aim = Math.atan2(dy, dx); const k = Math.min(d, 36)/(d || 1); knob.style.transform = 'translate(' + dx*k + 'px,' + dy*k + 'px)';
}
function onUp(e) {
  if (e.pointerType === 'mouse') { boost = false; return; }
  if (e.pointerId === steerId) { steerId = null; stick.style.display = 'none'; }
  if (e.pointerId === boostId) { boostId = null; boost = false; }
}
addEventListener('pointerdown', onDown); addEventListener('pointermove', onMove); addEventListener('pointerup', onUp); addEventListener('pointercancel', onUp);
const bb = $('boost'); let btnBoost = false;
bb.addEventListener('pointerdown', (e) => { e.stopPropagation(); btnBoost = true; bb.classList.add('on'); haptic('light'); });
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) bb.addEventListener(ev, () => { btnBoost = false; bb.classList.remove('on'); });
const keys = {};
addEventListener('keydown', (e) => { keys[e.code] = true; if (e.code === 'Space') e.preventDefault(); });
addEventListener('keyup', (e) => { keys[e.code] = false; });
function controls(dt) {
  if (MODE === 'demo') return; const me = meS(); if (!me || !me.alive) return;
  const kt = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0);
  if (kt) aim = (aim === null ? me.a : aim) + kt*G.TURN*dt*1.05;
  const b = boost || btnBoost || !!keys.Space || !!keys.ArrowUp || !!keys.KeyW, a = aim === null ? me.a : aim, t = performance.now();
  if ((Math.abs(a - sentA) > 0.03 || b !== sentB) && t - sentT > 45) { sentA = a; sentB = b; sentT = t;
    const c = { a: Math.round(a*1000)/1000, b: b ? 1 : 0 };
    if (MODE === 'solo' && LS) G.input(LS, 'me', c); else if (NET && NET.ws && NET.ws.readyState === 1) NET.ws.send(JSON.stringify({ t: 'in', c })); }
}

// ---- rooms -------------------------------------------------------------
function netJoin(room) {
  netLeave(); LS = null; MODE = 'net'; M = G.mirror(); overShown = false;
  const N = NET = { room, ws: null, me: null, players: [], tries: 0, link: 'https://t.me/' + BOT + '?startapp=r_' + room }; show('lobby'); $('lWho').textContent = 'Подключаюсь…'; $('lList').innerHTML = '';
  const open = () => { if (NET !== N) return; const ws = N.ws = new WebSocket((zt().ws || API.replace('https:', 'wss:')) + '/ws?room=' + room + '&init=' + encodeURIComponent(initStr()));
    ws.onopen = () => { N.tries = 0; };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } netMsg(N, m); };
    ws.onclose = (e) => { if (NET !== N) return; if (e.code === 4000) { toast('Ты зашёл в эту комнату с другого устройства', 3000); goHome(); return; } if (++N.tries > 4) { toast('Нет связи с комнатой', 3000); goHome(); return; } setTimeout(open, 800*N.tries); }; };
  open(); N.ping = setInterval(() => { if (N.ws && N.ws.readyState === 1) N.ws.send('{"t":"ping"}'); }, 20000);
}
function netMsg(N, m) {
  if (m.t === 'hello') { N.me = m.me; ME = m.me; }
  else if (m.t === 'full') { toast('Комната заполнена', 2500); goHome(); }
  else if (m.t === 'lobby') { N.players = m.players;
    const bots = Math.max(0, G.MAXS - m.players.length);
    $('lList').innerHTML = m.players.map((p) => '<span>' + (p.id === N.me ? '⭐ ' : '') + esc(p.name) + '</span>').join('') + (bots ? '<span class="bot">🤖 ×' + bots + '</span>' : '');
    $('lWho').textContent = m.players.length < 2 ? 'Пока ты один. Позови друзей — или начинай с ботами.' : 'В комнате ' + m.players.length + ' из ' + G.MAXS + '. Свободные места займут боты. Начать может любой.';
    if (m.ph === 'play' && !$('lobby').classList.contains('hidden') && M.ready) { show(null); $('hud').classList.add('on'); }
    if (m.ph !== 'play' && $('over').classList.contains('hidden')) { show('lobby'); $('hud').classList.remove('on'); } }
  else if (m.t === 's') { applySnap(m.s); if (m.s.full && M.ph === 'play' && $('over').classList.contains('hidden')) { show(null); $('hud').classList.add('on'); } }
}
function netLeave() { if (!NET) return; const N = NET; NET = null; clearInterval(N.ping); try { N.ws && N.ws.close(); } catch (e) {} }
async function netNew() {
  if (!initStr()) { toast('С друзьями — в Telegram: @' + BOT, 3000); return; }
  try { const r = await (await fetch((zt().api || API) + '/new', { method: 'POST', body: JSON.stringify({ init: initStr() }) })).json(); if (r.ok) netJoin(r.id); else toast('Не получилось создать комнату', 2500); } catch (e) { toast('Нет связи с сервером', 2500); }
}
function netInvite() { if (!NET) return; const N = NET;
  const old = () => { const url = 'https://t.me/share/url?url=' + encodeURIComponent(N.link) + '&text=' + encodeURIComponent('Го в Неон Змейки! 🐍'); if (TG && TG.openTelegramLink) TG.openTelegramLink(url); else { try { navigator.clipboard.writeText(N.link); toast('Ссылка скопирована'); } catch (e) { toast(N.link, 4000); } } };
  if (!TG || !TG.shareMessage || !initStr()) return old();
  fetch((zt().api || API) + '/share', { method: 'POST', body: JSON.stringify({ init: initStr(), room: N.room }) }).then((r) => r.json()).then((r) => { if (r && r.ok) { try { TG.shareMessage(r.id); } catch (e) { old(); } } else old(); }).catch(old); }
function goHome() { netLeave(); MODE = 'demo'; ME = null; $('hud').classList.remove('on'); show('home'); newLocal(false); }

$('goSolo').onclick = () => { MODE = 'solo'; overShown = false; aim = null; newLocal(true); show(null); $('hud').classList.add('on'); beep(1, 0.01); };
$('goNet').onclick = netNew;
$('goHelp').onclick = () => show('help'); $('helpBack').onclick = () => show('home');
$('lStart').onclick = () => { if (NET && NET.ws && NET.ws.readyState === 1) NET.ws.send('{"t":"start"}'); };
$('lInvite').onclick = netInvite; $('lLeave').onclick = goHome; $('toHome').onclick = goHome;
$('again').onclick = () => { aim = null; if (MODE === 'net') { if (NET && NET.ws && NET.ws.readyState === 1) NET.ws.send('{"t":"start"}'); show('lobby'); } else $('goSolo').onclick(); };

// ---- the loop: fixed-step rules, free-running pictures, and a speed check ----
let last = performance.now(), slow = 0, fast = 0, fpsT = 0, frames = 0, msSum = 0;
function loop(t) {
  requestAnimationFrame(loop); const dt = Math.min(0.1, (t - last)/1000); last = t; U.time.value = t/1000;
  const t0 = performance.now();
  if (LS) { acc += dt; let n = 0; while (acc >= G.TICK && n++ < 5) { G.step(LS); applySnap(G.snap(LS, false)); acc -= G.TICK; }
    if (MODE === 'demo' && LS.ph === 'over') { if (!LS.endAt) LS.endAt = t; else if (t - LS.endAt > 2500) newLocal(false); } }
  controls(dt); drawWorld(dt); hud(dt); R.render(scene, cam);
  // too slow for this phone? fewer pixels. Plenty of room? more.
  msSum += performance.now() - t0; frames++; fpsT += dt;
  if (fpsT > 2) { const fps = frames/fpsT; if (fps < 45 && DPR > 1) { DPR = Math.max(1, DPR - 0.25); R.setPixelRatio(DPR); resize(); } else if (fps > 58 && DPR < Math.min(2, devicePixelRatio || 1) && msSum/frames < 6) { DPR = Math.min(2, DPR + 0.25); R.setPixelRatio(DPR); resize(); } window.__fps = fps; window.__ms = msSum/frames; fpsT = 0; frames = 0; msSum = 0; }
}

// start: the menu over a live arena of bots, or straight into a room from a link
if (TG) { try { TG.ready(); TG.expand(); if (TG.disableVerticalSwipes) TG.disableVerticalSwipes(); TG.setHeaderColor && TG.setHeaderColor('#04050c'); TG.setBackgroundColor && TG.setBackgroundColor('#04050c'); } catch (e) {} }
newLocal(false); show('home'); $('load').style.display = 'none'; requestAnimationFrame(loop);
const sp = zt().start || (TG && TG.initDataUnsafe && TG.initDataUnsafe.start_param) || '', rm = /^r_([a-z0-9]{6,12})$/.exec(sp); if (rm && initStr()) netJoin(rm[1]);
window.__M = () => M; window.__net = () => NET; window.__mode = () => MODE; window.__solo = () => $('goSolo').onclick(); window.__aim = (a, b) => { aim = a; boost = b; };
