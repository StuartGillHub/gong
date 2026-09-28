/* The pool: a dark sheet of water with gongs resting beneath it.
 *
 * Everything is drawn in one WebGL fragment shader. Each ripple is a short
 * train of waves travelling outward from a gong; the shader adds them all
 * up into a water surface, lights it like a puddle catching a soft light,
 * and looks through it at the gongs, which bend with the waves.
 */
(function () {
  'use strict';
  const G = (window.G = window.G || {});

  const MAX_RIPPLES = 48;
  const MAX_GONGS = 8;

  const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

  const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uBright;
uniform int uCount;
uniform vec4 uRip[${MAX_RIPPLES}];   // x, y, start time, amplitude
uniform vec4 uRipB[${MAX_RIPPLES}];  // wavelength, speed, decay, train length
uniform vec3 uRipC[${MAX_RIPPLES}];
uniform int uGongs;
uniform vec4 uGong[${MAX_GONGS}];    // x, y, radius, glow
uniform vec4 uGongB[${MAX_GONGS}];   // presence, shimmer phase, -, -
uniform vec3 uGongC[${MAX_GONGS}];

const float TAU = 6.2831853;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// a gong seen from above: rim, hammered rings, a raised centre
float gongShape(vec2 q, vec4 g, vec4 gb, out float halo) {
  float r = length(q - g.xy) / g.z;
  float glow = g.w;
  float disc = 1.0 - smoothstep(0.96, 1.0, r);
  float rim = exp(-pow((r - 0.95) * 14.0, 2.0));
  float rings = 0.5 + 0.5 * cos(r * 34.0 - gb.y);
  float boss = 1.0 - smoothstep(0.22, 0.30, r);
  float bossEdge = exp(-pow((r - 0.28) * 30.0, 2.0));
  float face = disc * (0.35 + 0.25 * rings * (0.4 + glow)) + boss * 0.35 + bossEdge * 0.5 + rim * 0.6;
  halo = exp(-max(r - 0.9, 0.0) * 2.2) * (1.0 - disc * 0.6);
  return face;
}

void main() {
  float s = min(uRes.x, uRes.y);
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / s;

  vec2 grad = vec2(0.0);
  vec3 tint = vec3(0.0);
  float tw = 0.0;
  float crest = 0.0;

  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    if (i >= uCount) break;
    vec4 r = uRip[i];
    vec4 b = uRipB[i];
    float age = uTime - r.z;
    if (age <= 0.0) continue;
    vec2 dv = p - r.xy;
    float d = length(dv) + 1e-4;
    float x = b.y * age - d;              // distance behind the leading wave
    if (x <= 0.0) continue;
    float lam = b.x;
    float train = b.w;
    if (x > train) continue;
    float env = smoothstep(0.0, lam * 0.8, x) * (1.0 - smoothstep(train * 0.35, train, x));
    float a = r.w * exp(-age / b.z) / (1.0 + d * 1.6);
    float ph = TAU * x / lam;
    float m = a * env;
    float dw = m * cos(ph) * TAU / lam;
    grad -= dw * (dv / d);
    crest += m * max(sin(ph), 0.0);
    tint += uRipC[i] * m;
    tw += m;
  }

  vec3 tcol = tw > 1e-5 ? tint / tw : vec3(0.0);

  // light on the water: a soft reflected light plus a glow on the slopes
  vec3 n = normalize(vec3(-grad * 1.4, 1.0));
  vec3 L = normalize(vec3(-0.35, 0.55, 0.76));
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 40.0);
  spec = max(spec - 0.0006, 0.0);
  float slope = length(grad);
  float sheen = 1.0 - exp(-slope * 2.2);
  vec3 water = tcol * (sheen * 0.5 + crest * 15.0) + mix(tcol, vec3(1.0), 0.3) * spec * 2.4;

  // the gongs, seen through the moving water
  vec2 q = p + grad * 0.025;
  vec3 gcol = vec3(0.0);
  for (int j = 0; j < ${MAX_GONGS}; j++) {
    if (j >= uGongs) break;
    vec4 g = uGong[j];
    vec4 gb = uGongB[j];
    float halo;
    float face = gongShape(q, g, gb, halo);
    float vis = gb.x * (0.028 + g.w * 0.32);
    gcol += uGongC[j] * (face * vis + halo * g.w * 0.13 * gb.x);
  }

  vec3 col = gcol + water;
  col *= uBright;

  // gentle vignette and a soft tone curve
  float vig = 1.0 - smoothstep(0.55, 1.25, length(p * vec2(0.9, 1.0)));
  col *= mix(0.55, 1.0, vig);
  col = 1.0 - exp(-col * 1.3);

  // dither so dark gradients don't band on projectors
  col += (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) / 255.0;
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
`;

  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  }

  // calm colours, low pitch → warm, high pitch → cool
  const PALETTE = [
    [0.93, 0.70, 0.40], // amber
    [0.91, 0.55, 0.45], // soft coral
    [0.80, 0.52, 0.72], // rose
    [0.56, 0.58, 0.90], // lavender
    [0.38, 0.72, 0.78], // teal
    [0.55, 0.82, 0.70], // sea glass
    [0.80, 0.87, 0.95], // moonlight
  ];
  function colourFor(hz) {
    const t = Math.max(0, Math.min(1, Math.log2(hz / 70) / 5.2)) * (PALETTE.length - 1);
    const i = Math.min(PALETTE.length - 2, Math.floor(t));
    const f = t - i;
    return PALETTE[i].map((v, k) => v + (PALETTE[i + 1][k] - v) * f);
  }

  // where gongs rest: the deepest in the middle, the rest around it
  const SLOTS = [
    [0, 0], [-0.52, 0.06], [0.52, -0.06], [0, 0.3], [0, -0.3],
    [-0.46, -0.27], [0.46, 0.27], [-0.44, 0.3],
  ];

  class Pool {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
      if (!gl) throw new Error('WebGL is not available');
      this.gl = gl;
      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      this.prog = prog;
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      this.u = {};
      for (const name of ['uRes', 'uTime', 'uBright', 'uCount', 'uRip', 'uRipB', 'uRipC', 'uGongs', 'uGong', 'uGongB', 'uGongC']) {
        this.u[name] = gl.getUniformLocation(prog, name);
      }
      this.rip = new Float32Array(MAX_RIPPLES * 4);
      this.ripB = new Float32Array(MAX_RIPPLES * 4);
      this.ripC = new Float32Array(MAX_RIPPLES * 3);
      this.gong = new Float32Array(MAX_GONGS * 4);
      this.gongB = new Float32Array(MAX_GONGS * 4);
      this.gongC = new Float32Array(MAX_GONGS * 3);

      this.ripples = [];
      this.gongs = new Map();   // listener gong id → visual gong
      this.brightness = 1;
      this.quality = 0.75;
      this.resize();
    }

    resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr * this.quality));
      const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr * this.quality));
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
        this.gl.viewport(0, 0, w, h);
      }
    }

    get aspect() { return this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight); }

    slotPosition(i) {
      const [x, y] = SLOTS[i % SLOTS.length];
      const a = this.aspect;
      // spread wider on wide screens, keep inside the frame on narrow ones
      const sx = a >= 1 ? Math.min(1, a / 1.78) * 1.0 : a * 0.9;
      const sy = a >= 1 ? 1 : 0.8;
      return [x * sx * (a >= 1 ? 1.2 : 1), y * sy];
    }

    // keep the deepest gong in the centre, others in order of arrival
    arrange() {
      const list = [...this.gongs.values()];
      if (!list.length) return;
      const deepest = list.reduce((a, b) => (b.pitch < a.pitch * 0.85 ? b : a));
      let slot = 1;
      for (const g of list.sort((a, b) => a.order - b.order)) {
        g.slot = g === deepest ? 0 : slot++;
      }
    }

    visualGong(src) {
      let g = this.gongs.get(src.id);
      if (!g) {
        g = {
          id: src.id,
          order: this.gongs.size,
          pitch: src.pitch,
          colour: colourFor(src.pitch),
          x: 0, y: 0, slot: 0,
          glow: 0, presence: 0, phase: 0,
          nextSwell: 0,
          radius: 0.1,
          placed: false,
        };
        this.gongs.set(src.id, g);
        this.arrange();
        const [x, y] = this.slotPosition(g.slot);
        g.x = x; g.y = y; g.placed = true;
      }
      g.pitch = g.pitch * 0.9 + src.pitch * 0.1;
      return g;
    }

    waveFor(hz) {
      const o = Math.max(0, Math.min(1, Math.log2(hz / 60) / 5.5));
      return {
        wavelength: 0.12 - 0.075 * o,
        speed: 0.075 + 0.07 * o,
        decay: 10 - 5 * o,
      };
    }

    addRipple(g, amp, now, train) {
      const w = this.waveFor(g.pitch);
      this.ripples.push({
        x: g.x, y: g.y, t: now, amp,
        wavelength: w.wavelength, speed: w.speed, decay: w.decay,
        train: w.wavelength * (train || 4),
        colour: g.colour,
      });
      if (this.ripples.length > MAX_RIPPLES) {
        // let the faintest ripple go
        let wi = 0, wv = Infinity;
        this.ripples.forEach((r, i) => {
          const v = r.amp * Math.exp(-(now - r.t) / r.decay);
          if (v < wv) { wv = v; wi = i; }
        });
        this.ripples.splice(wi, 1);
      }
    }

    strike(src, amp, now) {
      const g = this.visualGong(src);
      g.glow = Math.max(g.glow, amp);
      g.presence = 1;
      this.addRipple(g, amp * 0.009, now, 3.5);
      g.nextSwell = now + 1.1;
    }

    // called every frame with the listener's gongs
    step(srcGongs, now, dt) {
      for (const src of srcGongs) {
        const g = this.gongs.get(src.id);
        if (!g) continue;
        const res = Math.max(0, Math.min(1, src.resonance));
        const target = res * (src.amp || 0.6);
        g.glow += (target - g.glow) * (target > g.glow ? 0.2 : 0.02);
        // while it keeps ringing, it keeps sending out soft rings
        if (now >= g.nextSwell && res > 0.1 && now - src.lastStrike > 0.8) {
          this.addRipple(g, 0.0035 * res * (src.amp || 0.6), now, 2.2);
          g.nextSwell = now + 1.6 + 1.6 * Math.max(0, 1 - Math.log2(g.pitch / 60) / 5);
        }
        // gongs not heard for a long while sink out of view
        const quiet = now - src.lastSeen;
        const want = quiet > 120 ? 0 : 1;
        g.presence += (want - g.presence) * dt * 0.2;
      }
      for (const g of this.gongs.values()) {
        const [tx, ty] = this.slotPosition(g.slot);
        g.x += (tx - g.x) * Math.min(1, dt * 0.4);
        g.y += (ty - g.y) * Math.min(1, dt * 0.4);
        const o = Math.max(0, Math.min(1, Math.log2(g.pitch / 60) / 5));
        const target = g.slot === 0 ? 0.2 - 0.07 * o : 0.13 - 0.06 * o;
        g.radius += (target - g.radius) * Math.min(1, dt * 0.5);
        g.phase += dt * (1.2 + g.glow * 3);
      }
      this.ripples = this.ripples.filter((r) => {
        const age = now - r.t;
        return age < r.decay * 4 && r.speed * age - r.train < 2.2;
      });
    }

    forget() {
      this.gongs.clear();
      this.ripples = [];
    }

    render(now, idleGlow) {
      this.resize();
      const gl = this.gl, u = this.u;
      const n = Math.min(this.ripples.length, MAX_RIPPLES);
      for (let i = 0; i < n; i++) {
        const r = this.ripples[i];
        this.rip.set([r.x, r.y, r.t, r.amp], i * 4);
        this.ripB.set([r.wavelength, r.speed, r.decay, r.train], i * 4);
        this.ripC.set(r.colour, i * 3);
      }
      let gi = 0;
      if (this.gongs.size === 0) {
        // before anything is heard, a single gong rests faintly in the centre
        this.gong.set([0, 0, 0.18, idleGlow], 0);
        this.gongB.set([1, now * 0.5, 0, 0], 0);
        this.gongC.set(PALETTE[0], 0);
        gi = 1;
      } else {
        for (const g of this.gongs.values()) {
          if (gi >= MAX_GONGS) break;
          this.gong.set([g.x, g.y, g.radius, g.glow], gi * 4);
          this.gongB.set([g.presence, g.phase, 0, 0], gi * 4);
          this.gongC.set(g.colour, gi * 3);
          gi++;
        }
      }
      gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
      gl.uniform1f(u.uTime, now);
      gl.uniform1f(u.uBright, this.brightness);
      gl.uniform1i(u.uCount, n);
      gl.uniform4fv(u.uRip, this.rip);
      gl.uniform4fv(u.uRipB, this.ripB);
      gl.uniform3fv(u.uRipC, this.ripC);
      gl.uniform1i(u.uGongs, gi);
      gl.uniform4fv(u.uGong, this.gong);
      gl.uniform4fv(u.uGongB, this.gongB);
      gl.uniform3fv(u.uGongC, this.gongC);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  G.Pool = Pool;
})();
