// Neon snakes: drawing, controls, menus and the connection to a room. The rules live in sim.js.
import * as THREE from 'three';
import * as G from './sim.js?v=1.37';

const VERSION = G.VERSION;
// the game talks to the server it was loaded from (the real one or the test copy); a preview elsewhere uses the real one
const API = /\.workers\.dev$/.test(location.hostname) ? location.origin : 'https://snakes.basirxujamuradov.workers.dev', BOT = 'NeonSnakesGameBot';
const $ = (id) => document.getElementById(id);
const TG = window.Telegram && Telegram.WebApp && Telegram.WebApp.initData ? Telegram.WebApp : null;
const zt = () => window.ZT || {}, initStr = () => zt().init || (TG ? TG.initData : '');
const hex = (c) => '#' + c.toString(16).padStart(6, '0');
const esc = (s) => String(s).replace(/[<>&"]/g, '');
const haptic = (k) => { try { TG && TG.HapticFeedback && TG.HapticFeedback.impactOccurred(k || 'light'); } catch (e) {} };

// ---- renderer --------------------------------------------------------------
const canvas = $('gl');
const HIDPI = (window.devicePixelRatio || 1) >= 2;
const R = new THREE.WebGLRenderer({ canvas, antialias: !HIDPI, powerPreference: 'high-performance' });
R.setClearColor(0x04060e); R.outputColorSpace = THREE.SRGBColorSpace;
const TOUCH = matchMedia('(pointer: coarse)').matches;
let DPR = Math.min(window.devicePixelRatio || 1, TOUCH ? 1.25 : 1.5); R.setPixelRatio(DPR);
const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x04060e, 55, 120);
const cam = new THREE.PerspectiveCamera(50, 1, 0.5, 400);
function resize() { const w = innerWidth, h = innerHeight; R.setSize(w, h, false); cam.aspect = w/h; cam.fov = w < h ? 64 : 48; cam.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
const U = { time: { value: 0 } };

// the floor: a grid that glows under every head, a ring where the arena ends
const HEADS = 6, FLOOR_R = G.RE + 30;
// The floor costs nothing per pixel: the background is the clear colour, the grid is thin strips of geometry
// (only the pixels they cover are drawn), and the edge is a narrow ring plus a dark skirt outside it.
function gridMesh() {
  const pos = [], col = [], E = FLOOR_R, add = (x0, z0, x1, z1, w, c) => { const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz), nx = -dz/l*w/2, nz = dx/l*w/2;
    const v = [[x0 + nx, z0 + nz], [x0 - nx, z0 - nz], [x1 + nx, z1 + nz], [x1 - nx, z1 - nz]]; for (const k of [0, 1, 2, 2, 1, 3]) { pos.push(v[k][0], 0, v[k][1]); col.push(c[0], c[1], c[2]); } };
  for (let k = -Math.floor(E/5)*5; k <= E; k += 5) { const major = k % 10 === 0, half = Math.sqrt(Math.max(0, E*E - k*k)); if (half < 1) continue; const w = major ? 0.09 : 0.06, c = major ? [0, 0.075, 0.11] : [0, 0.04, 0.062];
    add(k, -half, k, half, w, c); add(-half, k, half, k, w, c); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, fog: true, side: THREE.DoubleSide }));
}
const floor = gridMesh(); floor.position.y = -0.01; scene.add(floor);
// the edge line with a soft glow outwards, and everything beyond it dimmed
const floorMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  uniforms: { uR: { value: G.RE }, uWarn: { value: 0 } },
  vertexShader: `varying vec2 vP; void main(){ vec4 w = modelMatrix*vec4(position,1.); vP = w.xz; gl_Position = projectionMatrix*viewMatrix*w; }`,
  fragmentShader: `uniform float uR, uWarn; varying vec2 vP; void main(){ float dr = length(vP)-uR;
    float line = smoothstep(.22,.0,abs(dr))*.9 + exp(-abs(dr)*3.5)*.22*step(0.,dr), dim = smoothstep(0.,.6,dr)*.75;
    gl_FragColor = vec4(mix(vec3(0.,.94,1.), vec3(1.,.17,.5), uWarn)*line, dim); }` });
let edgeR = -1; const EDGE_SEG = 128, edge = new THREE.Mesh(new THREE.RingGeometry(G.RE - 0.6, FLOOR_R + 1, EDGE_SEG, 1), floorMat); edge.rotation.x = -Math.PI/2; edge.position.y = 0.005; edge.renderOrder = 1; scene.add(edge);
function edgeAt(r) { if (Math.abs(r - edgeR) < 0.02) return; edgeR = r; const p = edge.geometry.attributes.position, a = p.array, ri = Math.max(0.1, r - 0.6);
  for (let i = 0; i <= EDGE_SEG; i++) { const t = i/EDGE_SEG*Math.PI*2; a[i*3] = Math.cos(t)*ri; a[i*3 + 1] = Math.sin(t)*ri; } p.clearUpdateRanges(); p.addUpdateRange(0, (EDGE_SEG + 1)*3); p.needsUpdate = true; }
edgeAt(G.RE);

// the wall of light around the arena
const wallMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  uniforms: { uTime: U.time, uWarn: { value: 0 } },
  vertexShader: `varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform float uTime, uWarn; varying vec2 vU; void main(){ float a = pow(1.-vU.y, 2.2)*.4; a *= .75+.25*sin(vU.x*300.-uTime*3.); vec3 c = mix(vec3(0.,.94,1.), vec3(1.,.17,.5), uWarn); gl_FragColor = vec4(c*a, 1.); }` });
const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 2.2, 96, 1, true), wallMat); wall.position.y = 1.1; scene.add(wall);

// ---- snakes: a lit neon tube each, built fresh from the body points every frame ----
const MAXPT = 720, RING = 8;
// A body is a tube round a line of points. The phone sends the graphics chip only that line (four numbers a point:
// x, z, thickness, stripe position) as a tiny texture; the chip itself puts the eight-sided ring round every point.
// That is 14 times less to build and send every frame than making every vertex here (the way three.js draws skeletons).
const tubeVS = `uniform sampler2D uPts; uniform float uN, uY; attribute float aI, aC, aS; varying vec3 vN, vV, vW; varying float vU;
  void main(){ int i = int(aI + .5), n = int(uN + .5);
    vec4 p = texelFetch(uPts, ivec2(i, 0), 0), a = texelFetch(uPts, ivec2(max(i - 1, 0), 0), 0), b = texelFetch(uPts, ivec2(min(i + 1, n - 1), 0), 0);
    vec2 t = a.xy - b.xy; float tl = length(t); t = tl > 1e-5 ? t/tl : vec2(1., 0.);
    vec3 nrm = vec3(-t.y*aC, aS, t.x*aC), pos = vec3(p.x, uY, p.y) + nrm*p.z;
    vU = p.w; vW = nrm; vec4 mv = modelViewMatrix*vec4(pos, 1.); vN = normalMatrix*nrm; vV = -mv.xyz; gl_Position = projectionMatrix*mv; }`;
const headVS = `varying vec3 vN, vV, vW; varying float vU;
  void main(){ vU = 0.; vW = normal; vec4 mv = modelViewMatrix*vec4(position,1.); vN = normalMatrix*normal; vV = -mv.xyz; gl_Position = projectionMatrix*mv; }`;
const tubeFS = `uniform vec3 uCol; uniform float uTime, uBoost, uFade, uSq; varying vec3 vN, vV, vW; varying float vU;
  void main(){
    float f = 1.-abs(dot(normalize(vN), normalize(vV)));
    float stripe = smoothstep(.35,.65,.5+.5*sin(vU*1.3 - uTime*(2.5+uBoost*14.)));
    vec3 c = uCol*(.42+.16*stripe+uBoost*.2);
    c += vec3(1.)*pow(1.-f,3.)*(.14+.08*stripe);
    c += uCol*pow(f,2.)*.55;
    c += vec3(1.)*pow(max(vW.y,0.),12.)*.12;
    c += uCol*uSq*(.16+.2*smoothstep(.2,1.,sin(vU*1.1 + uTime*7.)));   // tightening a coil: slow bright waves run down the body
    gl_FragColor = vec4(c*uFade, 1.);
  }`;
const HEADG = new THREE.SphereGeometry(1, 16, 12);
function tubeIndex() { const idx = []; for (let i = 0; i < MAXPT - 1; i++) for (let k = 0; k < RING; k++) { const a = i*RING + k, b = i*RING + (k + 1)%RING, c = a + RING, d = b + RING; idx.push(a, b, c, b, d, c); } return idx; }
const IDX = tubeIndex();
const eyeW = new THREE.MeshBasicMaterial({ color: 0xffffff }), eyeB = new THREE.MeshBasicMaterial({ color: 0x05060d });
const eyeG = new THREE.SphereGeometry(1, 10, 6);
const EYEW = new THREE.InstancedMesh(eyeG, eyeW, G.MAXS*2), EYEB = new THREE.InstancedMesh(eyeG, eyeB, G.MAXS*2), eyeM = new THREE.Matrix4();   // two eyes for every snake there can be
EYEW.frustumCulled = EYEB.frustumCulled = false; scene.add(EYEW, EYEB); let ei = 0;
// the name over a head. A real person: a gold plate with a star, bigger. A bot: small and grey.
function label(text, col, human) {
  const c = document.createElement('canvas'); c.width = 384; c.height = 96; const x = c.getContext('2d'); x.textAlign = 'center'; x.textBaseline = 'middle';
  if (human) { x.font = '800 40px Manrope, system-ui, sans-serif'; const t = '★ ' + text, w = Math.min(372, x.measureText(t).width + 44), l = 192 - w/2;
    x.beginPath(); x.roundRect(l, 16, w, 64, 32); x.fillStyle = 'rgba(40,28,0,.82)'; x.fill(); x.lineWidth = 4; x.strokeStyle = '#ffd24a'; x.shadowColor = '#ffd24a'; x.shadowBlur = 14; x.stroke();
    x.shadowBlur = 0; x.fillStyle = '#ffe9a0'; x.fillText(t, 192, 50, 340); }
  else { x.font = '700 30px Manrope, system-ui, sans-serif'; x.shadowColor = 'rgba(0,0,0,.9)'; x.shadowBlur = 8; x.fillStyle = 'rgba(190,204,224,.8)'; x.fillText(text, 192, 50, 360); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false })); const k = human ? 1.25 : 0.9; s.scale.set(7.8*k, 1.95*k, 1); s.renderOrder = human ? 6 : 5; return s;
}
const VIS = [];
// the ring layout is the same for every snake and never changes: which point a vertex belongs to, and where on the ring it sits
const RINGA = (() => { const aI = new Float32Array(MAXPT*RING), aC = new Float32Array(MAXPT*RING), aS = new Float32Array(MAXPT*RING);
  for (let i = 0; i < MAXPT; i++) for (let q = 0; q < RING; q++) { const o = i*RING + q, th = q/RING*Math.PI*2; aI[o] = i; aC[o] = Math.cos(th); aS[o] = Math.sin(th); }
  return { aI: new THREE.BufferAttribute(aI, 1), aC: new THREE.BufferAttribute(aC, 1), aS: new THREE.BufferAttribute(aS, 1), pos: new THREE.BufferAttribute(new Float32Array(MAXPT*RING*3), 3), idx: new THREE.BufferAttribute(new Uint32Array(IDX), 1) }; })();
function vis(i) {
  if (VIS[i]) return VIS[i];
  const g = new THREE.BufferGeometry(); g.setAttribute('position', RINGA.pos); g.setAttribute('aI', RINGA.aI); g.setAttribute('aC', RINGA.aC); g.setAttribute('aS', RINGA.aS);
  g.setIndex(RINGA.idx); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  const D = new Float32Array(MAXPT*4), tex = new THREE.DataTexture(D, MAXPT, 1, THREE.RGBAFormat, THREE.FloatType); tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  const uniforms = { uCol: { value: new THREE.Color() }, uTime: U.time, uBoost: { value: 0 }, uFade: { value: 1 }, uSq: { value: 0 }, uPts: { value: tex }, uN: { value: 0 }, uY: { value: 0 } };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: tubeVS, fragmentShader: tubeFS });
  const body = new THREE.Mesh(g, mat); body.frustumCulled = false;
  const head = new THREE.Mesh(HEADG, new THREE.ShaderMaterial({ uniforms, vertexShader: headVS, fragmentShader: tubeFS }));   // the same uniforms: one colour, one blink
  scene.add(body, head);
  return VIS[i] = { body, head, mat, g, D, tex, tag: null, tagName: '', fan: null, sqA: 0 };
}

const FANMAX = 64;
const fanVS = `attribute float aR; varying float vR; void main(){ vR = aR; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`;
const fanFS = `uniform vec3 uCol; uniform float uTime, uA; varying float vR;
  void main(){ float rim = pow(vR, 2.2), wave = smoothstep(.55,1.,sin(vR*13. + uTime*5.))*vR; gl_FragColor = vec4(uCol*(.05 + .22*rim + .13*wave)*uA, 1.); }`;
function fanFor(v) {
  if (v.fan) return v.fan;
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((FANMAX + 2)*3), 3).setUsage(THREE.DynamicDrawUsage));
  const aR = new Float32Array(FANMAX + 2).fill(1); aR[0] = 0; geo.setAttribute('aR', new THREE.BufferAttribute(aR, 1));
  const idx = []; for (let i = 1; i <= FANMAX; i++) idx.push(0, i, i + 1); geo.setIndex(idx); geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uCol: v.mat.uniforms.uCol, uTime: U.time, uA: { value: 0 } }, vertexShader: fanVS, fragmentShader: fanFS });
  v.fan = new THREE.Mesh(geo, mat); v.fan.frustumCulled = false; v.fan.renderOrder = 2; scene.add(v.fan); return v.fan;
}
// the stretch of body PX/PZ[0..n] becomes the rim of the disc
function fanBuild(v, n, cx, cz) {
  const f = fanFor(v), P = f.geometry.attributes.position.array, m = Math.min(FANMAX, n + 1); P[0] = cx; P[1] = 0.05; P[2] = cz;
  for (let j = 0; j < m; j++) { const k = Math.round(j*n/Math.max(1, m - 1)); P[(j + 1)*3] = PX[k]; P[(j + 1)*3 + 1] = 0.05; P[(j + 1)*3 + 2] = PZ[k]; }
  P[(m + 1)*3] = PX[0]; P[(m + 1)*3 + 1] = 0.05; P[(m + 1)*3 + 2] = PZ[0];
  const a = f.geometry.attributes.position; a.clearUpdateRanges(); a.addUpdateRange(0, (m + 2)*3); a.needsUpdate = true; f.geometry.setDrawRange(0, m*3);
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
  vertexShader: pointVS, fragmentShader: `varying vec3 vC; void main(){ vec2 p = gl_PointCoord-.5; float a = exp(-dot(p,p)*18.)*.15; gl_FragColor = vec4(vC*a,1.); }` });
const glow = new THREE.Points(glowG, glowMat); glow.frustumCulled = false; scene.add(glow);

// food: a bright core inside a soft halo, each light breathing on its own beat
const FOODN = 1600;
const foodG = new THREE.BufferGeometry();
foodG.setAttribute('position', new THREE.BufferAttribute(new Float32Array(FOODN*3), 3).setUsage(THREE.DynamicDrawUsage));
foodG.setAttribute('color', new THREE.BufferAttribute(new Float32Array(FOODN*3), 3).setUsage(THREE.DynamicDrawUsage));
foodG.setAttribute('size', new THREE.BufferAttribute(new Float32Array(FOODN), 1).setUsage(THREE.DynamicDrawUsage));
const foodMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uScale: SCALE, uTime: U.time },
  vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; uniform float uScale, uTime;
    void main(){ vC = color; vec4 mv = modelViewMatrix*vec4(position,1.); float b = .85+.15*sin(uTime*3.+position.x*1.7+position.z*1.3); gl_PointSize = size*b*uScale/-mv.z; gl_Position = projectionMatrix*mv; }`,
  fragmentShader: `varying vec3 vC; void main(){ vec2 p = gl_PointCoord-.5; float d = length(p); float core = smoothstep(.12,.06,d); float a = exp(-d*d*26.)*.45; gl_FragColor = vec4(mix(vC*a, vC*.6+.35, core*.7),1.); }` });
const foodPts = new THREE.Points(foodG, foodMat); foodPts.frustumCulled = false; scene.add(foodPts);

// sparks: bursts when a snake dies, a trail when one dashes
const SPN = 700, SP = [];
const spG = new THREE.BufferGeometry();
spG.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPN*3), 3).setUsage(THREE.DynamicDrawUsage));
spG.setAttribute('color', new THREE.BufferAttribute(new Float32Array(SPN*3), 3).setUsage(THREE.DynamicDrawUsage));
spG.setAttribute('size', new THREE.BufferAttribute(new Float32Array(SPN), 1).setUsage(THREE.DynamicDrawUsage));
const spMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uScale: SCALE },
  vertexShader: pointVS, fragmentShader: `varying vec3 vC; void main(){ vec2 p = gl_PointCoord-.5; float d = length(p); float a = smoothstep(.5,.0,d); gl_FragColor = vec4(vC*a*a*.9,1.); }` });
const spPts = new THREE.Points(spG, spMat); spPts.frustumCulled = false; scene.add(spPts);
function spark(x, y, z, vx, vy, vz, col, life, size) { if (SP.length >= SPN) return; SP.push({ x, y, z, vx, vy, vz, r: ((col >> 16) & 255)/255, g: ((col >> 8) & 255)/255, b: (col & 255)/255, life, max: life, size }); }
function burst(x, z, col, n) { for (let k = 0; k < n; k++) { const a = Math.random()*Math.PI*2, v = 3 + Math.random()*12, up = 2 + Math.random()*8; spark(x, 0.6, z, Math.cos(a)*v, up, Math.sin(a)*v, col, 0.6 + Math.random()*0.8, 0.5 + Math.random()*0.9); } }

// ---- sound: a few synth blips, nothing to download ----
let AC = null;
function beep(f, d, type, vol, slide) { try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); const t = AC.currentTime, o = AC.createOscillator(), g = AC.createGain(); o.type = type || 'sine'; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d); g.gain.setValueAtTime(vol || 0.08, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.connect(g).connect(AC.destination); o.start(t); o.stop(t + d); } catch (e) {} }
let eatT = 0, eatN = 0, NOISE = null;
// "хлюп": a short burst of wet noise through a falling filter, over a pitch that drops
function slurp(big) {
  try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); const t = AC.currentTime;
    if (!NOISE) { NOISE = AC.createBuffer(1, AC.sampleRate*0.2, AC.sampleRate); const d = NOISE.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random()*2 - 1; }
    const up = eatN++ % 2 ? 1.18 : 1, f0 = (big ? 520 : 760)*up*(0.94 + Math.random()*0.12), len = big ? 0.16 : 0.1;
    const o = AC.createOscillator(), og = AC.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0*0.35, t + len);
    og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(big ? 0.09 : 0.06, t + 0.012); og.gain.exponentialRampToValueAtTime(0.0001, t + len);
    const n = AC.createBufferSource(), bp = AC.createBiquadFilter(), ng = AC.createGain(); n.buffer = NOISE; bp.type = 'bandpass'; bp.Q.value = 6; bp.frequency.setValueAtTime(f0*2.2, t); bp.frequency.exponentialRampToValueAtTime(f0*0.6, t + len);
    ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(big ? 0.05 : 0.03, t + 0.008); ng.gain.exponentialRampToValueAtTime(0.0001, t + len*0.8);
    o.connect(og).connect(AC.destination); n.connect(bp).connect(ng).connect(AC.destination); o.start(t); o.stop(t + len + 0.02); n.start(t); n.stop(t + len); } catch (e) {}
}
// phones only allow sound after a touch or a key: wake the sound up on the first one
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); } catch (e) {} }, { passive: true });

// ---- the game being shown --------------------------------------------------
// the arena setting for solo play, remembered on this phone
let FIXED = false; try { FIXED = localStorage.getItem('fixed') === '1'; } catch (e) {}
function arenaLabel(f) { return f ? '⭕ Арена: не сжимается' : '🎯 Арена: сжимается'; }
let FT0 = performance.now();   // the time of the frame being drawn: prediction and ticks all measure against it
let ALPHA = 1, Q = [], playTick = 0, lastTick = 0, curTick = 0, CLK = G.playClock();
let MODE = 'demo', LS = null, M = G.mirror(), ME = null, NET = null, acc = 0, overShown = false, lastCount = 99;
// your snake is (re)born: the death card goes, the controls start fresh
let DEATH = null, BORN = 0, deathT = 0;
function born() { BORN = M.tm; DEATH = null; clearTimeout(deathT); AUTH = null; INLOG.length = 0; corrX = corrZ = corrA = 0; KH = null; aim = null; sentA = 99; sentR = 0;
  if (!$('over').classList.contains('hidden')) show(null); $('hud').classList.add('on'); big('ВПЕРЁД!', 700); haptic('medium'); }
function showDeath() {
  if (!DEATH || MODE === 'demo') return; const me = meS(); if (me && me.alive) return;
  $('hud').classList.remove('on'); $('big').classList.remove('on'); show('over');
  const m = Math.floor(DEATH.t/60), sec = Math.floor(DEATH.t%60);
  $('oTitle').innerHTML = 'ТЫ РАЗБИЛСЯ<small>' + (DEATH.by ? 'врезался в ' + esc(DEATH.by) : 'о стену арены') + '</small>';
  const top = M.sn.filter((o) => o.alive).sort((a, b) => b.L - a.L).slice(0, 5);
  $('res').innerHTML = '<div class="me"><span class="n">📏 ' + DEATH.L + ' · 💥 ' + DEATH.kills + ' · ⏱ ' + m + ':' + String(sec).padStart(2, '0') + '</span><span class="s">' + DEATH.rank + ' место из ' + DEATH.of + '</span></div>'
    + '<p class="lb">Сейчас на арене лучшие:</p>' + top.map((r, k) => '<div><span class="p">' + (k + 1) + '</span><i style="color:' + hex(G.COLORS[r.col % G.COLORS.length]) + '"></i><span class="n' + (r.bot ? '' : ' hum') + '">' + (r.bot ? '' : '★ ') + esc(r.name) + '</span><span class="s">📏 ' + Math.floor(r.L) + '</span></div>').join('');
  if (MODE === 'net' && NET) $('res').innerHTML += '<p class="lb">📶 пинг ' + (NET.diedPing || Math.round(RTT*1000)) + ' мс' + (NET.diedLag ? ' · в момент гибели связь тормозила' : '') + '</p>';
  $('oInvite').classList.toggle('hidden', MODE !== 'net' || !!(NET && NET.pub));
}
function applySnap(o) {
  const evs = G.apply(M, o); curTick = o.tm;
  for (const e of evs) onEvent(e);

}
function newLocal(withMe) {
  LS = G.newGame((Math.random()*1e9) | 0); G.fillBots(LS); if (withMe) G.spawnHuman(LS, 'me', 'Ты');
  M = G.mirror(); ME = withMe ? 'me' : null; acc = 0; AUTH = null; INLOG.length = 0; corrX = corrZ = corrA = 0; $('feed').innerHTML = ''; lastCount = 99; applySnap(G.snap(LS, true));
}
const meS = () => M.sn.find((s) => s.id === ME && s.alive) || M.sn.find((s) => s.id === ME);
function nameOf(s) { return s.id === ME ? 'Ты' : s.name; }
function onEvent(e) {
  if (e.t === 'spawn') { if (e.w[0] === ME && MODE !== 'demo') born(); return; }
  if (e.t === 'die') { const s = M.sn[e.i]; if (!s) return; const col = G.COLORS[s.col % G.COLORS.length]; burst(e.x, e.z, col, 70);
    const by = e.by >= 0 ? M.sn[e.by] : null; if (by) by.kills = (by.kills || 0) + 1;
    if (s.id === ME && NET) { NET.tok = null; NET.diedLag = NET.badAt && performance.now() - NET.badAt < 2500; NET.diedPing = Math.round(RTT*1000); }
    if (s.id === ME && MODE !== 'demo') { DEATH = { L: Math.floor(s.L), kills: s.kills || 0, t: M.tm - (BORN || 0), by: by ? by.name : '', rank: 1 + M.sn.filter((o) => o.alive && o.L > s.L).length, of: M.sn.filter((o) => o.alive).length + 1 }; clearTimeout(deathT); deathT = setTimeout(showDeath, 1400); }
    if (MODE !== 'demo') { feed(by ? nameOf(by) + ' → ' + nameOf(s) : nameOf(s) + ' разбил' + (s.id === ME ? 'ся' : 'ся') + ' о стену', s.id === ME || (by && by.id === ME));
      const me = meS(); const dist = me ? Math.hypot(me.x - e.x, me.z - e.z) : 99;
      if (s.id === ME) { big('Ты разбился!<small>' + (by ? 'врезался в ' + esc(by.name) : 'стена арены') + '</small>', 2200); haptic('heavy'); beep(180, 0.5, 'sawtooth', 0.12, 40); }
      else if (by && by.id === ME) { big('Есть!<small>' + esc(s.name) + ' врезался в тебя</small>', 1500); haptic('medium'); beep(520, 0.25, 'square', 0.07, 1040); }
      else if (dist < 30) beep(260, 0.3, 'triangle', 0.06, 90); } }
  else if (e.t === 'eat' && MODE !== 'demo') { const s = M.sn[e.i]; if (s && s.id === ME && performance.now() - eatT > 75) { eatT = performance.now(); slurp(!!e.v); } }
}

// ---- your own snake answers your hand at once ----
// The phone moves its own snake itself from the newest word of the game, with the keys as they are right now;
// whatever the game then says only nudges it, smoothly. Everyone else is drawn as the game said.
const INLOG = [];   // what the controls said and when: { t, r, a, b, key }
let AUTH = null, RTT = 0.1, corrX = 0, corrZ = 0, corrA = 0, predLast = null;
const PRED = { own: true, ok: false, x: 0, z: 0, a: 0, path: [], bx: 0, bz: 0, ba: 0 };
function logInput(c, key) { const t = FT0; INLOG.push({ t, r: c.r | 0, a: c.a, b: !!c.b, key }); while (INLOG.length > 2 && INLOG[1].t < t - 3000) INLOG.shift(); }
function inputAt(t) { let v = null; for (let i = INLOG.length - 1; i >= 0; i--) if (INLOG[i].t <= t) { v = INLOG[i]; break; } return v || INLOG[0] || null; }
function setAuth(x, z, a, L, alive, t0, tm) {
  // where the old word put the head right now, against where the new word puts it at the same moment:
  // only a real disagreement becomes a correction, never the distance moved since the last frame
  const old = predLast && AUTH && AUTH.alive ? predict(FT0, false) : null;
  AUTH = { x, z, a, L, alive, t0, tm };
  if (old && alive) { const p = predict(FT0, false); if (p) { corrX += old.x - p.x; corrZ += old.z - p.z; } }
}
const wrapA = (a) => { while (a > Math.PI) a -= 2*Math.PI; while (a < -Math.PI) a += 2*Math.PI; return a; };
function predict(now, keepPath) {
  if (!AUTH || !AUTH.alive || !(AUTH.tm > 0)) return null;
  const lag = MODE === 'net' ? RTT*500 : 0, end = now + lag, from = AUTH.t0; if (end - from > 600) return null;
  let x = AUTH.x, z = AUTH.z, a = AUTH.a, t = from; const path = keepPath ? PRED.path : null; if (path) path.length = 0;
  while (t < end) { const h = Math.min(1000/60, end - t); t += h; const inp = inputAt(t - lag); if (!inp) { x += Math.cos(a)*G.V*h/1000; z += Math.sin(a)*G.V*h/1000; continue; }
    const bst = inp.b && AUTH.L > G.LMIN, turn = G.TURN*(bst ? 0.8 : 1)*h/1000;
    if (inp.key) a = wrapA(a + inp.r*turn); else if (Number.isFinite(inp.a)) { const d = wrapA(inp.a - a); a = wrapA(a + Math.max(-turn, Math.min(turn, d))); }
    const v = (bst ? G.VB : G.V)*h/1000; x += Math.cos(a)*v; z += Math.sin(a)*v; if (path) path.push(x, z); }
  return { x, z, a };
}
function predFrame(dt) {
  PRED.ok = false; const me = meS(); if (MODE === 'demo' || !me || !me.alive || !AUTH || !AUTH.alive) { corrX = corrZ = corrA = 0; predLast = null; return; }
  const p = predict(FT0, true); if (!p) { predLast = null; return; }
  const k = Math.exp(-dt*12); corrX *= k; corrZ *= k; corrA = 0; predLast = p;
  PRED.ok = true; PRED.x = p.x + corrX; PRED.z = p.z + corrZ; PRED.a = src === 'key' && KH !== null ? KH : p.a; PRED.bx = AUTH.x; PRED.bz = AUTH.z; PRED.ba = AUTH.a;
}

// ---- drawing a frame -------------------------------------------------------
const tmpC = new THREE.Color();
let RINGN = -1;   // how far along the drawn body the coil goes
const PX = new Float32Array(MAXPT), PZ = new Float32Array(MAXPT), PU = new Float32Array(MAXPT);
// the body from the drawn head back along the laid points, cut at exactly its length so the tail glides instead of hopping
function buildTube(v, s, hx, hz, L, r, pre) {
  const fx = Math.cos(s.a), fz = Math.sin(s.a), tr = s.tr, want = L*G.SEG;
  // a coil that tightened on this tick is drawn part of the way there, so it glides in instead of stepping 20 times a second
  const sq = s.sq, pull = sq && sq.tm === curTick && sq.f < 1 ? 1 + (1/sq.f - 1)*(1 - ALPHA) : 1; RINGN = -1;
  let n = 1, cum = 0, k = 0; PX[0] = hx; PZ[0] = hz;
  // your own snake: the path the phone predicted, newest first, then where the game last put the head
  let bx = hx, bz = hz, bfx = fx, bfz = fz;
  if (pre) { const P2 = pre.path, cnt = P2.length/2;
    const kx = pre.own ? corrX : 0, kz = pre.own ? corrZ : 0;
    for (let j = cnt - 2; j >= 0 && n < MAXPT - 2; j -= 2) { const px = P2[j*2] + kx*(j/cnt), pz = P2[j*2 + 1] + kz*(j/cnt), d = Math.hypot(px - PX[n - 1], pz - PZ[n - 1]); if (cum + d >= want) break; cum += d; PX[n] = px; PZ[n] = pz; n++; }
    const d = Math.hypot(pre.bx - PX[n - 1], pre.bz - PZ[n - 1]); if (cum + d < want) { cum += d; PX[n] = pre.bx; PZ[n] = pre.bz; n++; }
    bx = pre.bx; bz = pre.bz; bfx = Math.cos(pre.ba); bfz = Math.sin(pre.ba); }
  while (k < tr.length && k < 8 && (tr[k][0] - bx)*bfx + (tr[k][1] - bz)*bfz > -0.05) k++;   // points the drawn head has not reached yet (a few at most: a body pressed into a small space lies all round its head)
  const baseU = ((s.n || 0) - k + 1)*G.SEG + (k < tr.length ? Math.hypot(tr[k][0] - bx, tr[k][1] - bz) : 0);
  PU[0] = baseU + cum; for (let j = 1, run = 0; j < n; j++) { run += Math.hypot(PX[j] - PX[j - 1], PZ[j] - PZ[j - 1]); PU[j] = baseU + cum - run; }
  // Where the body runs straight, most of its points add nothing: one is kept every 1.5 units there, all of them in a
  // bend. A snake going straight is drawn with a third of the triangles, and a third of the work to build them.
  const k0 = k; let bend = 0, skipped = 0;
  for (; k < tr.length && n < MAXPT; k++) {
    let x = tr[k][0], z = tr[k][1]; const coil = sq && k <= sq.k; if (coil && pull !== 1) { x = sq.cx + (x - sq.cx)*pull; z = sq.cz + (z - sq.cz)*pull; }
    const d = Math.hypot(x - PX[n - 1], z - PZ[n - 1]);
    if (cum + d >= want) { const f = d > 0 ? (want - cum)/d : 0; PX[n] = PX[n - 1] + (x - PX[n - 1])*f; PZ[n] = PZ[n - 1] + (z - PZ[n - 1])*f; PU[n] = PU[n - 1] - d*f; cum = want; n++; break; }
    if (k > k0 + 2 && k + 1 < tr.length) { const a = tr[k - 1], b = tr[k], c = tr[k + 1]; bend += ((b[0] - a[0])*(c[1] - b[1]) - (b[1] - a[1])*(c[0] - b[0]))*4; if (bend < 0.07 && bend > -0.07 && d < 1.1 && skipped < 4) { skipped++; continue; } }
    bend = 0; skipped = 0; if (coil) RINGN = n;
    cum += d; PX[n] = x; PZ[n] = z; PU[n] = ((s.n || 0) - k)*G.SEG; n++;
  }
  const total = Math.max(cum, 0.01), D = v.D; let run = 0;
  for (let i = 0, o = 0; i < n; i++, o += 4) { if (i) run += Math.hypot(PX[i] - PX[i - 1], PZ[i] - PZ[i - 1]); D[o] = PX[i]; D[o + 1] = PZ[i]; D[o + 2] = r*G.taper(run/total); D[o + 3] = PU[i]; }
  v.tex.needsUpdate = true; v.mat.uniforms.uN.value = n; v.mat.uniforms.uY.value = r*0.95; v.g.setDrawRange(0, Math.max(0, n - 1)*RING*6);
  return n;
}
const COS = Array.from({ length: RING }, (_, q) => Math.cos(q/RING*Math.PI*2)), SIN = Array.from({ length: RING }, (_, q) => Math.sin(q/RING*Math.PI*2));
function upd(geo, n) { const a = geo.attributes; for (const [x, k] of [[a.position, 3], [a.color, 3], [a.size, 1]]) { x.clearUpdateRanges(); x.addUpdateRange(0, Math.max(1, n)*k); x.needsUpdate = true; } }
let spLast = 0;
let gi = 0; const GP = glowG.attributes.position.array, GC = glowG.attributes.color.array, GS = glowG.attributes.size.array;
function glowAt(x, y, z, col, size) { if (gi >= GLOWN) return; GP[gi*3] = x; GP[gi*3 + 1] = y; GP[gi*3 + 2] = z; GC[gi*3] = col.r; GC[gi*3 + 1] = col.g; GC[gi*3 + 2] = col.b; GS[gi] = size; gi++; }

// a snake whose whole body is far from what the camera sees is not built at all this frame
function near(s) { const reach = camH*1.3 + s.L*G.SEG + 4; return Math.abs(s.x - camT.x) < reach && Math.abs(s.z - camT.z) < reach; }
const camT = new THREE.Vector3(0, 0, 0), camP = new THREE.Vector3(0, 60, 40); let camH = 30, follow = -1;
// Your own snake is drawn where it will be when your hand reaches the game; everyone else used to be drawn where
// they were a moment ago. That gap (a couple of body widths at speed) is what made near misses count as crashes.
// So the others are carried forward by the same amount along the way they are going: their bodies follow the true
// path, only the last stretch in front of the head is an estimate, eased so it does not twitch.
function leadTime() { return MODE === 'solo' ? G.TICK : 0; }   // online the others are drawn exactly as the game sent them: carrying them forward made their heads twitch
function ahead(v, s, bx, bz, dt, lead) {
  const E = v.ex || (v.ex = { own: false, id: null, om: 0, sp: G.V, path: [], bx: 0, bz: 0, ba: 0, x: 0, z: 0, a: 0 });
  const pa = Number.isFinite(s.pa) ? s.pa : s.a, om = Math.max(-G.TURN, Math.min(G.TURN, wrapA(s.a - pa)/G.TICK)), sp = s.boosting ? G.VB : G.V;
  if (E.id !== s.id) { E.id = s.id; E.om = om; E.sp = sp; } else { const k = Math.min(1, dt*12); E.om += (om - E.om)*k; E.sp += (sp - E.sp)*k; }
  let a = pa + wrapA(s.a - pa)*ALPHA, x = bx, z = bz; E.path.length = 0; E.bx = bx; E.bz = bz; E.ba = a;
  const n = 4, h = lead/n; for (let i = 0; i < n; i++) { a += E.om*h; x += Math.cos(a)*E.sp*h; z += Math.sin(a)*E.sp*h; E.path.push(x, z); }
  E.x = x; E.z = z; E.a = wrapA(a); return E;
}
// being in a coil, or holding one, is felt: a word when it starts, a pulse at the screen's edge for the one inside,
// a low beat that rises as the coil tightens, and the camera leans in a little
const COIL = { role: null, was: null, name: '', tight: 0, endT: 0, beatT: 0, zoom: 1, cx: 0, cz: 0, r: 0, look: 0, fit: 0 };
function coilFeel(dt) {
  const now = performance.now(), role = COIL.role;
  if (!role && COIL.was) COIL.endT = now;
  COIL.was = role;
  $('danger').style.opacity = role === 'prey' ? 0.18 + 0.32*COIL.tight : 0;   // a quiet red edge for the one inside, stronger as it tightens
  // both of them see the whole coil: the camera eases over towards its middle and pulls back far enough to fit it
  COIL.look += ((role ? 0.4 : 0) - COIL.look)*Math.min(1, dt*0.9); COIL.fit += ((role ? COIL.r*3.6 + 2 : 0) - COIL.fit)*Math.min(1, dt*0.9);
}
function drawWorld(dt) {
  const al = ALPHA;
  floorMat.uniforms.uR.value = M.R; edgeAt(M.R); wall.scale.set(M.R, 1, M.R);
  const warn = !M.fixed && M.tm > G.SHRINK - 3 && M.R > G.RMIN + 0.01 ? 1 : 0; floorMat.uniforms.uWarn.value += (warn - floorMat.uniforms.uWarn.value)*Math.min(1, dt*3); wallMat.uniforms.uWarn.value = floorMat.uniforms.uWarn.value;
  gi = 0; ei = 0; COIL.role = null; const LEAD = leadTime();
  HEAD.ok = false;
  M.sn.forEach((s, i) => {
    const v = vis(i), col = G.COLORS[s.col % G.COLORS.length]; v.mat.uniforms.uCol.value.setHex(col);
    const show = s.alive && near(s); v.body.visible = v.head.visible = show;
    if (!show) { v.sqA = 0; if (v.fan) v.fan.visible = false; }
    if (v.tag) v.tag.visible = false;
    if (!show) return;
    const mine = s.id === ME && PRED.ok, Lr = s.pL + (s.L - s.pL)*al, r = G.radius(Lr);
    let hx = mine ? PRED.x : s.px + (s.x - s.px)*al, hz = mine ? PRED.z : s.pz + (s.z - s.pz)*al, pre = mine ? PRED : null, ha = mine ? PRED.a : s.a;
    if (!mine && s.id !== ME && LEAD > 0 && M.tm > 0) { pre = ahead(v, s, hx, hz, dt, LEAD); hx = pre.x; hz = pre.z; ha = pre.a; }
    if (s.id === ME) { HEAD.x = hx; HEAD.z = hz; HEAD.ok = true; }
    v.mat.uniforms.uBoost.value += ((s.boosting ? 1 : 0) - v.mat.uniforms.uBoost.value)*Math.min(1, dt*8);
    v.mat.uniforms.uFade.value = s.safe ? 0.45 + 0.4*Math.abs(Math.sin(performance.now()/90)) : 1;   // just born: blinking, cannot be hit
    const np = buildTube(v, s, hx, hz, Lr, r, pre);
    // tightening a coil around someone: the floor inside lights up, the body pulses, sparks are drawn inwards
    const sq = s.sq, coiling = !!sq && curTick - sq.tm <= 2 && RINGN > 6;
    v.sqA += ((coiling ? 1 : 0) - v.sqA)*Math.min(1, dt*(coiling ? 1.2 : 3)); v.mat.uniforms.uSq.value = v.sqA*0.4;
    if (coiling) { const tight = Math.max(0, Math.min(1, (8 - sq.r)/5.5)), prey = M.sn[sq.v];
      fanBuild(v, RINGN, sq.cx, sq.cz); v.fan.material.uniforms.uA.value = v.sqA*(0.22 + 0.3*tight);
      if (MODE !== 'demo') { if (prey && prey.alive && prey.id === ME) { COIL.role = 'prey'; COIL.name = s.name; COIL.tight = tight; COIL.cx = sq.cx; COIL.cz = sq.cz; COIL.r = sq.r; } else if (s.id === ME && COIL.role !== 'prey') { COIL.role = 'coil'; COIL.name = prey ? prey.name : ''; COIL.tight = tight; COIL.cx = sq.cx; COIL.cz = sq.cz; COIL.r = sq.r; } } }
    else if (v.fan) v.fan.material.uniforms.uA.value = v.sqA*0.22;
    if (v.fan) v.fan.visible = v.sqA > 0.02;
    const hr = r*1.18; v.head.position.set(hx, r*0.95, hz); v.head.scale.setScalar(hr);
    const fx = Math.cos(ha), fz = Math.sin(ha), sx = -fz, sz = fx;
    for (let k = 0; k < 2; k++) { const side = k ? 1 : -1, ex = hx + fx*hr*0.45 + sx*side*hr*0.5, ez = hz + fz*hr*0.45 + sz*side*hr*0.5, ey = r*0.95 + hr*0.55, a = hr*0.34, b = hr*0.19;
      eyeM.makeScale(a, a, a).setPosition(ex, ey, ez); EYEW.setMatrixAt(ei, eyeM); eyeM.makeScale(b, b, b).setPosition(ex + fx*hr*0.17, ey + hr*0.08, ez + fz*hr*0.17); EYEB.setMatrixAt(ei, eyeM); ei++; }
    tmpC.setHex(col);
    if (QL > 0 && s.id === ME) for (let k = 2; k < np; k += 3) glowAt(PX[k], 0.3, PZ[k], tmpC, r*6*(1 - k/np*0.5));
    glowAt(hx, 0.2, hz, tmpC, r*11);
    if (s.boosting && Math.random() < (QL > 0 ? 0.6 : 0.25)) spark(PX[np - 1], r, PZ[np - 1], (Math.random() - 0.5)*3, 1 + Math.random()*2, (Math.random() - 0.5)*3, col, 0.5, 0.45);
    if (MODE !== 'demo' && s.id !== ME) { const key = (s.bot ? 'b:' : 'h:') + s.name; if (!v.tag || v.tagName !== key) { if (v.tag) { scene.remove(v.tag); v.tag.material.map.dispose(); v.tag.material.dispose(); } v.tag = label(s.name, col, !s.bot); v.tagName = key; scene.add(v.tag); } v.tag.visible = true; v.tag.position.set(hx, r*2 + (s.bot ? 2.0 : 2.5), hz); }
  });
  for (let i = M.sn.length; i < VIS.length; i++) { const v = VIS[i]; if (!v) continue; v.body.visible = v.head.visible = false; if (v.tag) v.tag.visible = false; if (v.fan) v.fan.visible = false; }
  coilFeel(dt);
  EYEW.count = EYEB.count = ei; EYEW.instanceMatrix.needsUpdate = EYEB.instanceMatrix.needsUpdate = true;
  glowG.setDrawRange(0, gi); upd(glowG, gi);

  // food
  if (M.fv !== foodV) { foodV = M.fv;
  let fi = 0; const FP = foodG.attributes.position.array, FC = foodG.attributes.color.array, FS = foodG.attributes.size.array;
  for (const [id, f] of M.food) { if (fi >= FOODN) break; FP[fi*3] = f[0]; FP[fi*3 + 1] = 0.35 + f[2]*0.12; FP[fi*3 + 2] = f[1]; tmpC.setHex(G.COLORS[id % G.COLORS.length]); FC[fi*3] = tmpC.r; FC[fi*3 + 1] = tmpC.g; FC[fi*3 + 2] = tmpC.b; FS[fi] = 2.2 + f[2]*1.6; fi++; }
  foodG.setDrawRange(0, fi); upd(foodG, fi); }

  // sparks
  const SPp = spG.attributes.position.array, SPc = spG.attributes.color.array, SPs = spG.attributes.size.array; let si = 0;
  for (let k = SP.length - 1; k >= 0; k--) { const p = SP[k]; p.life -= dt; if (p.life <= 0) { SP[k] = SP[SP.length - 1]; SP.pop(); continue; } p.vy -= 18*dt; p.x += p.vx*dt; p.y = Math.max(0.1, p.y + p.vy*dt); p.z += p.vz*dt; p.vx *= 0.97; p.vz *= 0.97;
    const f = p.life/p.max; SPp[si*3] = p.x; SPp[si*3 + 1] = p.y; SPp[si*3 + 2] = p.z; SPc[si*3] = p.r*f; SPc[si*3 + 1] = p.g*f; SPc[si*3 + 2] = p.b*f; SPs[si] = p.size; si++; }
  spG.setDrawRange(0, si); if (si || spLast) upd(spG, si); spLast = si;

  // the camera follows you; once you are out, whoever is longest
  const me = meS(); let tgt = me && me.alive ? me : null;
  if (!tgt) { const alive = M.sn.filter((s) => s.alive).sort((a, b) => b.L - a.L); tgt = alive.find((s) => s.i === follow) || alive[0]; }
  if (tgt) { follow = tgt.i; const pm = tgt.id === ME && PRED.ok; let hx = pm ? PRED.x : tgt.px + (tgt.x - tgt.px)*al, hz = pm ? PRED.z : tgt.pz + (tgt.z - tgt.pz)*al;
    if (COIL.look > 0.01 && tgt.id === ME) { hx += (COIL.cx - hx)*COIL.look; hz += (COIL.cz - hz)*COIL.look; } const kk = 1 - Math.exp(-dt*(MODE === 'demo' ? 1.5 : 10)); camT.x += (hx - camT.x)*kk; camT.z += (hz - camT.z)*kk;
    const want = Math.max(((MODE === 'demo' ? 40 : 21) + Math.min(20, tgt.L*0.06))*COIL.zoom, tgt.id === ME ? COIL.fit : 0); camH += (want - camH)*Math.min(1, dt*2); }
  camP.set(camT.x, camH, camT.z + camH*0.5); cam.position.copy(camP); cam.lookAt(camT.x, 0, camT.z - 2);
  SCALE.value = innerHeight*DPR/(2*Math.tan(cam.fov*Math.PI/360));
}
let foodV = -1;

// ---- hud ---------------------------------------------------------------
let hudT = 0, boardH = '';
const mini = $('mini').getContext('2d');
function hud(dt) {
  hudT -= dt; if (hudT > 0 || MODE === 'demo') return; hudT = 0.2;

  const alive = M.sn.filter((s) => s.alive); $('hAlive').textContent = '🐍 ' + alive.length + (MODE === 'net' && NET && NET.players ? (NET.pub ? ' · 🌍 ' : ' · 👥 ') + NET.players.length : '');
  // the connection, when it matters: nothing heard for a moment, or a slow line
  { const lc = $('lag'); let txt = ''; if (MODE === 'net' && NET) { const quiet = NET.heard ? performance.now() - NET.heard : 0; if (!NET.ws || NET.ws.readyState !== 1 || quiet > 400) { txt = '📶 нет связи…'; NET.badAt = performance.now(); } else if (RTT > 0.3) { txt = '📶 ' + Math.round(RTT*1000) + ' мс'; NET.badAt = performance.now(); } }
    if (lc.textContent !== txt) lc.textContent = txt; lc.style.display = txt ? 'block' : 'none'; }
  const me = meS(); $('hLen').textContent = me ? (me.alive ? '📏 ' + Math.floor(me.L) : '👀 смотришь') : '';
  // the eight longest, and every real person on the arena whatever their length (you included)
  const all = M.sn.filter((s) => s.alive).sort((a, b) => b.L - a.L), rows = all.slice(0, 8); for (const s of all) if (!s.bot && !rows.includes(s) && rows.length < 13) rows.push(s);
  const bh = rows.map((s) => '<div class="' + (s.id === ME ? 'me ' : s.bot ? '' : 'hum ') + (s.alive ? '' : 'dead') + '">' + (s.bot || s.id === ME ? '' : '★ ') + esc(nameOf(s)) + ' ' + Math.floor(s.L) + '<i style="color:' + hex(G.COLORS[s.col % G.COLORS.length]) + '"></i></div>').join(''); if (bh !== boardH) { boardH = bh; $('board').innerHTML = bh; }
  // minimap
  const W = 184, k = W/2/((M.R0 || G.RE) + 2); mini.clearRect(0, 0, W, W); mini.save(); mini.translate(W/2, W/2);
  mini.strokeStyle = floorMat.uniforms.uWarn.value > 0.5 ? '#ff2b80' : '#00f0ff'; mini.lineWidth = 2; mini.beginPath(); mini.arc(0, 0, M.R*k, 0, Math.PI*2); mini.stroke();
  for (const s of M.sn) { if (!s.alive) continue; mini.fillStyle = hex(G.COLORS[s.col % G.COLORS.length]); const big = s.id === ME; mini.beginPath(); mini.arc(s.x*k, s.z*k, big ? 6 : (s.bot ? 3.5 : 5) + Math.min(3, s.L/80), 0, Math.PI*2); mini.fill(); if (!big && !s.bot) { mini.strokeStyle = '#ffd24a'; mini.lineWidth = 2.5; mini.stroke(); } if (big) { mini.strokeStyle = '#fff'; mini.lineWidth = 2; mini.stroke(); } }
  mini.restore();
}
function feed(text, mine) { const d = document.createElement('div'); d.textContent = text; if (mine) d.style.border = '1px solid #00f0ff'; $('feed').prepend(d); while ($('feed').children.length > 4) $('feed').lastChild.remove(); setTimeout(() => d.remove(), 3300); }
let bigT = 0; function big(html, ms) { const e = $('big'); e.innerHTML = html; e.classList.add('on'); clearTimeout(bigT); bigT = setTimeout(() => e.classList.remove('on'), ms || 1500); }
let toastT = 0; function toast(t, ms) { const e = $('toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => e.classList.remove('on'), ms || 2000); }
function show(id) { for (const s of ['home', 'help', 'lobby', 'over']) $(s).classList.toggle('hidden', s !== id); }

// ---- controls: drag anywhere to steer, a second finger or the button to dash ----
// Directions are measured on the floor, not on the glass: the camera looks down at an angle.
let sentR = 0; const keys = {};
let aim = null, boost = false, steerId = null, boostId = null, ox = 0, oy = 0, sentA = 99, sentB = false, sentT = 0, src = null, mouse = null;
const stick = $('stick'), knob = stick.firstElementChild, ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hitP = new THREE.Vector3();
const HEAD = { x: 0, z: 0, ok: false };
function ground(cx, cy) { ndc.set(cx/innerWidth*2 - 1, -(cy/innerHeight)*2 + 1); ray.setFromCamera(ndc, cam); return ray.ray.intersectPlane(plane, hitP) ? [hitP.x, hitP.z] : null; }
function onDown(e) {
  if (MODE === 'demo' || e.target.closest('button') || e.target.closest('#boost')) return;
  if (e.pointerType === 'mouse') return;   // on a computer: keys only, the mouse never steers
  // phones: the first finger steers like a joystick from where it landed; a second finger dashes while it is down
  if (steerId === null) { src = 'touch'; sentR = 0; KH = null; steerId = e.pointerId; ox = e.clientX; oy = e.clientY; stick.style.left = ox + 'px'; stick.style.top = oy + 'px'; stick.style.display = 'block'; knob.style.transform = ''; }
  else if (boostId === null) { boostId = e.pointerId; boost = true; haptic('light'); }
}
function onMove(e) {
  if (MODE === 'demo') return;
  if (e.pointerType === 'mouse') return;
  if (e.pointerId !== steerId) return; const dx = e.clientX - ox, dy = e.clientY - oy, d = Math.hypot(dx, dy);
  if (d > 8) { const a = ground(ox, oy), b = ground(e.clientX, e.clientY); aim = a && b ? Math.atan2(b[1] - a[1], b[0] - a[0]) : Math.atan2(dy, dx); }
  const k = Math.min(d, 36)/(d || 1); knob.style.transform = 'translate(' + dx*k + 'px,' + dy*k + 'px)';
}
function onUp(e) {
  if (e.pointerType === 'mouse') return;
  if (e.pointerId === steerId) { steerId = null; stick.style.display = 'none'; }
  if (e.pointerId === boostId) { boostId = null; boost = false; }
}
addEventListener('pointerdown', onDown); addEventListener('pointermove', onMove); addEventListener('pointerup', onUp); addEventListener('pointercancel', onUp);
addEventListener('blur', () => { boost = false; for (const k in keys) keys[k] = false; });
if (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) document.body.classList.add('touch');
for (const [id, code] of [['tL', 'TouchL'], ['tR', 'TouchR']]) { const el = $(id);
  el.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); keys[code] = true; el.classList.add('on'); haptic('light'); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, () => { keys[code] = false; el.classList.remove('on'); }); }
const bb = $('boost'); let btnBoost = false;
bb.addEventListener('pointerdown', (e) => { e.stopPropagation(); btnBoost = true; bb.classList.add('on'); haptic('light'); });
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) bb.addEventListener(ev, () => { btnBoost = false; bb.classList.remove('on'); });
addEventListener('keydown', (e) => { keys[e.code] = true; if (/^(Space|Arrow)/.test(e.code)) e.preventDefault(); });
addEventListener('keyup', (e) => { keys[e.code] = false; });
let KH = null;   // with keys, the phone keeps the heading itself and the game just follows it
function controls(dt) {
  if (MODE === 'demo') return; const me = meS(); if (!me || !me.alive) { KH = null; return; }
  const r = (keys.ArrowRight || keys.KeyD || keys.TouchR ? 1 : 0) - (keys.ArrowLeft || keys.KeyA || keys.TouchL ? 1 : 0);
  const b = boost || btnBoost || !!keys.Space || !!keys.ShiftLeft || !!keys.ShiftRight || !!keys.KeyW || !!keys.ArrowUp, t = performance.now();
  if (M.tm <= 0) { KH = null; return; }
  if (r) { if (src !== 'key' || KH === null) KH = PRED.ok ? PRED.a : me.a; src = 'key'; KH = wrapA(KH + r*G.TURN*(b && me.L > G.LMIN ? 0.8 : 1)*dt); }
  const a = src === 'key' && KH !== null ? KH : (aim === null ? me.a : aim);
  const released = src === 'key' && r === 0 && sentR !== 0; sentR = r;
  if (!((Math.abs(wrapA(a - sentA)) > 0.004 && t - sentT > 30) || b !== sentB || released)) return;
  const c = { a: Math.round(a*1000)/1000, b: b ? 1 : 0 }; sentA = a; sentB = b; sentT = t; logInput(c, false);
  if (MODE === 'solo' && LS) G.input(LS, 'me', c); else if (NET && NET.ws && NET.ws.readyState === 1) NET.ws.send(JSON.stringify({ t: 'in', c }));
}

// ---- rooms -------------------------------------------------------------
function netJoin(room) {
  netLeave(); LS = null; MODE = 'net'; M = G.mirror(); overShown = false; Q.length = 0; lastTick = playTick = curTick = 0;
  const N = NET = { room, ws: null, me: null, players: [], tries: 0, link: 'https://t.me/' + BOT + '?startapp=r_' + room }; show(null); $('hud').classList.add('on'); toast('Подключаюсь к арене…', 1500);
  // coming back after a dropped connection, the phone shows the game's last receipt for its snake
  const open = () => { if (NET !== N) return; const ws = N.ws = new WebSocket((zt().ws || API.replace('https:', 'wss:')) + '/ws?room=' + room + '&init=' + encodeURIComponent(initStr()) + (N.joined && N.tok ? '&res=' + encodeURIComponent(N.tok) : ''));
    ws.onopen = () => { N.tries = 0; };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } netMsg(N, m); };
    ws.onclose = (e) => { if (NET !== N) return; if (e.code === 4000) { toast('Ты зашёл в эту комнату с другого устройства', 3000); goHome(); return; } if (++N.tries > 10) { toast('Нет связи с ареной', 3000); goHome(); return; } if (N.tries === 1) toast('Связь прервалась — возвращаюсь…', 4000); setTimeout(open, N.tries === 1 ? 200 : Math.min(3000, 700*(N.tries - 1))); }; };
  // a word every 150 ms so the game knows this phone is still there (silence means a failing connection, and gets the snake covered)
  N.beat = setInterval(() => { if (N.ws && N.ws.readyState === 1) N.ws.send('{"t":"hb"}'); }, 150);
  open(); N.ping = setInterval(() => { if (N.ws && N.ws.readyState === 1) N.ws.send(JSON.stringify({ t: 'ping', k: performance.now() })); }, 2000);
}
function netMsg(N, m) {
  if (m.t === 'hello') { N.me = m.me; ME = m.me; N.pub = !!m.pub; N.fresh = true; if (m.sv && m.sv !== VERSION && !N.told) { N.told = true; setTimeout(() => toast('Вышла версия ' + m.sv + ' — закрой и открой игру, когда будет удобно', 6000), 3000); } if (N.joined) toast(m.kept === 1 ? 'Связь вернулась — змейка твоя' : m.kept === 2 ? 'Арена перезапустилась — длина сохранена' : 'Связь вернулась', 2500); N.joined = true; }
  else if (m.t === 'pong') { if (m.tok) N.tok = m.tok; if (m.k) { const r = (performance.now() - m.k)/1000; if (r > 0 && r < 2) RTT = RTT*0.7 + r*0.3; } }
  else if (m.t === 'full') { toast('Комната заполнена', 2500); goHome(); }
  else if (m.t === 'lobby') { const before = (N.players || []).map((p) => p.id); N.players = m.players;
    for (const p of m.players) if (before.length && !before.includes(p.id) && p.id !== N.me) feed('👋 ' + p.name + ' зашёл на арену'); }
  else if (m.t === 's') { N.heard = performance.now(); netSnap(m.s); }
}
// phones get ticks unevenly over the air; play them back a couple of ticks late, at an even pace
function netSnap(s) {
  if (s.full && (!M.ready || s.tm < lastTick - 5 || (NET && NET.fresh))) { if (NET) NET.fresh = false; Q.length = 0; applySnap(s); playTick = lastTick = s.tm; CLK = G.playClock(); G.clockHeard(CLK, s.tm, performance.now()); ALPHA = 1; AUTH = null; INLOG.length = 0; corrX = corrZ = corrA = 0; return; }
  if (!M.ready) return; Q.push(s); lastTick = s.tm; G.clockHeard(CLK, s.tm, performance.now());
  const i = M.sn.findIndex((v) => v.id === ME), h = i >= 0 && s.sn[i];
  if (h) setAuth(h[1]/100, h[2]/100, h[3]/100, h[4]/100, !!(h[5] & 1), performance.now() - RTT*500, s.tm/20);
}
function netPlay(dt) {
  if (MODE !== 'net' || !M.ready) return;
  playTick = G.clockPlay(CLK, playTick, lastTick, dt, performance.now());
  while (Q.length && Q[0].tm <= playTick) applySnap(Q.shift());
  ALPHA = Math.max(0, Math.min(1, playTick - curTick));
}
function netLeave() { if (!NET) return; const N = NET; NET = null; clearInterval(N.ping); clearInterval(N.beat); try { if (N.ws && N.ws.readyState === 1) N.ws.send('{"t":"bye"}'); N.ws && N.ws.close(); } catch (e) {} }
// online: the matchmaker sends you to a public arena with other people in it
async function netOnline() {
  if (!initStr()) { toast('Онлайн — внутри Telegram: @' + BOT + '. Пока — с ботами', 3000); $('goSolo').onclick(); return; }
  try { const r = await (await fetch((zt().api || API) + '/play', { method: 'POST', body: JSON.stringify({ init: initStr() }) })).json();
    if (r.ok && r.room) { netJoin(r.room); return; } } catch (e) {}
  toast('Онлайн сейчас недоступен — играем с ботами', 3000); $('goSolo').onclick();
}
async function netNew() {
  if (!initStr()) { toast('С друзьями — в Telegram: @' + BOT, 3000); return; }
  try { const r = await (await fetch((zt().api || API) + '/new', { method: 'POST', body: JSON.stringify({ init: initStr() }) })).json(); if (r.ok) netJoin(r.id); else toast('Не получилось создать комнату', 2500); } catch (e) { toast('Нет связи с сервером', 2500); }
}
function netInvite() { if (!NET) return; const N = NET;
  const old = () => { const url = 'https://t.me/share/url?url=' + encodeURIComponent(N.link) + '&text=' + encodeURIComponent('Го в Неон Змейки! 🐍'); if (TG && TG.openTelegramLink) TG.openTelegramLink(url); else { try { navigator.clipboard.writeText(N.link); toast('Ссылка скопирована'); } catch (e) { toast(N.link, 4000); } } };
  if (!TG || !TG.shareMessage || !initStr()) return old();
  fetch((zt().api || API) + '/share', { method: 'POST', body: JSON.stringify({ init: initStr(), room: N.room }) }).then((r) => r.json()).then((r) => { if (r && r.ok) { try { TG.shareMessage(r.id); } catch (e) { old(); } } else old(); }).catch(old); }
function goHome() { netLeave(); MODE = 'demo'; ME = null; $('hud').classList.remove('on'); show('home'); newLocal(false); }

$('goSolo').onclick = () => { MODE = 'solo'; aim = null; sentA = 99; sentR = 0; src = null; KH = null; newLocal(true); show(null); $('hud').classList.add('on'); beep(1, 0.01); };
$('goNet').onclick = netNew;
$('goOnline').onclick = netOnline;
$('goHelp').onclick = () => show('help'); $('helpBack').onclick = () => show('home');
$('lStart').onclick = () => { if (NET && NET.ws && NET.ws.readyState === 1) NET.ws.send('{"t":"start"}'); };
$('lInvite').onclick = netInvite; $('lLeave').onclick = goHome; $('toHome').onclick = goHome;
$('again').onclick = () => { if (MODE === 'net') { if (NET && NET.ws && NET.ws.readyState === 1) NET.ws.send('{"t":"spawn"}'); } else if (LS) G.spawnHuman(LS, 'me', 'Ты'); };
$('oInvite').onclick = netInvite;

// ---- the loop: fixed-step rules, free-running pictures, and a speed check ----
const PROF = { draw: 0, render: 0 };
let STATS = false, verTaps = 0, verT = 0, shaderBad = false;
let last = performance.now(), fpsT = 0, frames = 0, msSum = 0, QL = 1; const FT = [];
function setQ() { R.setPixelRatio(DPR); resize(); }
let CAP = 0;   // 0: every refresh; otherwise draw only when this many ms have passed (an even 60 on a 90/120 Hz screen)
function loop(t) {
  requestAnimationFrame(loop);
  if (document.hidden) { last = t; return; }
  if (CAP && t - last < CAP) return;
  const dt = Math.min(0.1, (t - last)/1000); last = t; FT0 = t; U.time.value = t/1000;
  const t0 = performance.now();
  if (LS) { if (LS.ph === 'play') { acc += dt; let n = 0; while (acc >= G.TICK && n++ < 5) { G.step(LS); applySnap(G.snap(LS, false)); acc -= G.TICK; } if (acc > G.TICK) acc = 0; ALPHA = acc/G.TICK;
      const ms = LS.sn.find((v) => v.id === 'me'); if (ms && n) setAuth(ms.x, ms.z, ms.a, ms.L, ms.alive, FT0 - acc*1000, LS.tm); } else ALPHA = 1;
    if (MODE === 'demo' && LS.ph === 'over') { if (!LS.endAt) LS.endAt = t; else if (t - LS.endAt > 2500) newLocal(false); } }
  netPlay(dt); controls(dt); predFrame(dt); const tA = performance.now(); drawWorld(dt); const tB = performance.now(); hud(dt); R.render(scene, cam); const tC = performance.now(); PROF.draw = PROF.draw*0.95 + (tB - tA)*0.05; PROF.render = PROF.render*0.95 + (tC - tB)*0.05;
  // too slow for this phone? Judge by frames that came late compared with this screen's own pace (60, 90 or 120 Hz):
  // fewer pixels first, then fewer effects. Only ever downwards, so it never hitches back and forth.
  msSum += performance.now() - t0; frames++; fpsT += dt; FT.push(dt);
  if (fpsT > 2) { FT.sort((a, b) => a - b); const base = FT[Math.floor(FT.length*0.2)], late = FT.filter((d) => d > base*1.6).length/FT.length;
    if (late > 0.08 && !window.__noAdapt) {
      // a fast screen the phone cannot keep up with: an even 60 looks far smoother than an uneven 120
      if (!CAP && base < 13) CAP = 12.5;
      else if (DPR > 1) { DPR = Math.max(1, DPR - 0.2); setQ(); } else if (QL > 0) { QL = 0; setQ(); } }
    if (!shaderBad && R.info.programs && R.info.programs.some((p) => p.diagnostics && p.diagnostics.runnable === false)) { shaderBad = true; $('ver').textContent = 'v' + VERSION + ' · графика: ошибка шейдера, напиши об этом'; }
    if (STATS) $('ver').textContent = 'v' + VERSION + ' · ' + Math.round(frames/fpsT) + ' fps · late ' + Math.round(late*100) + '% · ' + DPR.toFixed(2) + 'x' + (QL ? '' : ' lo') + (CAP ? ' · 60' : '') + (MODE === 'net' ? ' · пинг ' + Math.round(RTT*1000) + ' · буфер ' + Math.round(CLK.depth*50) + ' мс · неровность ' + Math.round(CLK.jit*50) + ' мс · замираний ' + CLK.dry : ''); CLK.dry = 0;
    window.__fps = frames/fpsT; window.__late = late; window.__ms = msSum/frames; fpsT = 0; frames = 0; msSum = 0; FT.length = 0; }
}

// start: the menu over a live arena of bots, or straight into a room from a link
if (TG) { try { TG.ready(); TG.expand(); if (TG.disableVerticalSwipes) TG.disableVerticalSwipes(); TG.setHeaderColor && TG.setHeaderColor('#04050c'); TG.setBackgroundColor && TG.setBackgroundColor('#04050c'); } catch (e) {} }
$('ver').textContent = 'v' + VERSION; $('ver').style.pointerEvents = 'auto';
$('ver').addEventListener('pointerdown', (e) => { e.stopPropagation(); const t = performance.now(); verTaps = t - verT < 600 ? verTaps + 1 : 1; verT = t; if (verTaps >= 3) { STATS = !STATS; verTaps = 0; if (!STATS) $('ver').textContent = 'v' + VERSION; } });
newLocal(false); burst(0, 0, 0xffffff, 1); try { R.compile(scene, cam); } catch (e) {} show('home'); $('load').style.display = 'none'; requestAnimationFrame(loop);
const sp = zt().start || (TG && TG.initDataUnsafe && TG.initDataUnsafe.start_param) || '', rm = /^r_([a-z0-9]{6,12})$/.exec(sp); if (rm && initStr()) netJoin(rm[1]);
window.__hide = (k) => { const o = { floor, wall, glow, food: foodPts, sparks: spPts }[k]; if (o) o.visible = false; if (k === 'snakes') VIS.forEach((v) => v && (v.body.material.visible = false)); if (k === 'hud') document.getElementById('hud').style.display = 'none'; }; window.__fixDpr = (d) => { DPR = d; QL = 1; R.setPixelRatio(d); resize(); window.__noAdapt = true; }; window.__GL = { R, scene, cam, floor, glow, foodPts, spPts, VIS, THREE }; window.__coil = () => COIL; window.__resync = () => { if (LS) applySnap(G.snap(LS, true)); }; window.__vis = () => VIS; window.__ringR = (i) => { const s = M.sn[i], q = s && s.sq; if (!q) return null; let r = 0, n = 0; const pull = q.tm === curTick && q.f < 1 ? 1 + (1/q.f - 1)*(1 - ALPHA) : 1; for (let k = 0; k <= q.k && k < s.tr.length; k++) { r += Math.hypot(s.tr[k][0] - q.cx, s.tr[k][1] - q.cz)*pull; n++; } return r/n; }; window.__LS = () => LS; window.__pred = () => PRED; window.__dbg = () => ({ ft: FT0, cx: corrX, cz: corrZ, at: AUTH && AUTH.t0, ax: AUTH && AUTH.x, acc, alpha: ALPHA }); window.__dpr = () => DPR; window.__prof = () => PROF; window.__M = () => M; window.__net = () => NET; window.__mode = () => MODE; window.__solo = () => $('goSolo').onclick(); window.__aim = (a, b) => { aim = a; boost = b; };
