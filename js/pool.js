/* The pool: still, dark water that a gong's sound disturbs.
 *
 * Each strike appears somewhere new on the water. A faint glow gathers
 * there, as if a gong were resting just beneath the surface, and a few
 * fine rings of light drift slowly outward, easing as they spread. The
 * water itself moves very gently, so the rings are never perfect circles.
 * Everything is drawn in one WebGL fragment shader.
 */
(function () {
  'use strict';
  const G = (window.G = window.G || {});

  const MAX_RIPPLES = 64;
  const MAX_BLOOMS = 12;

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
uniform vec4 uRipB[${MAX_RIPPLES}];  // spacing, speed, fade time, crests
uniform vec3 uRipC[${MAX_RIPPLES}];
uniform int uBlooms;
uniform vec4 uBloom[${MAX_BLOOMS}];  // x, y, size, intensity
uniform vec3 uBloomC[${MAX_BLOOMS}];

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// how far a ripple has spread: quick at first, then drifting to a near stop
float spread(float age, float speed) {
  float tau = 7.0;
  return speed * tau * (1.0 - exp(-age / tau)) + speed * 0.18 * age;
}

void main() {
  float s = min(uRes.x, uRes.y);
  float px = 1.0 / s;
  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / s;

  // the water drifts a little, so nothing is ever perfectly round
  float t = uTime * 0.035;
  vec2 warp = vec2(noise(p * 2.2 + vec2(t, -t * 0.7)), noise(p * 2.2 + vec2(5.2 - t * 0.6, 1.3 + t))) - 0.5;
  vec2 q = p + warp * 0.018;

  vec3 col = vec3(0.0);

  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    if (i >= uCount) break;
    vec4 r = uRip[i];
    vec4 b = uRipB[i];
    float age = uTime - r.z;
    if (age <= 0.0) continue;
    float d = length(q - r.xy);
    float front = spread(age, b.y);
    if (d > front + 0.05) continue;
    float fade = exp(-age / b.z) * smoothstep(0.0, 1.2, age);
    float gap = b.x * (1.0 + age * 0.05);          // rings drift apart as they travel
    float w = px * (1.1 + front * 3.0);              // and soften
    float light = 0.0;
    for (int k = 0; k < 4; k++) {
      if (float(k) >= b.w) break;
      float rk = front - float(k) * gap;
      if (rk <= 0.0) break;
      float x = d - rk;
      float fine = exp(-(x * x) / (w * w));
      float haze = exp(-(x * x) / (w * w * 60.0)) * 0.10;
      light += (fine + haze) * pow(0.55, float(k));
    }
    col += uRipC[i] * light * r.w * 1.45 * fade / (1.0 + front * 2.5);
  }

  // where a gong sounds: a soft glow, and the faintest hint of its rim
  for (int j = 0; j < ${MAX_BLOOMS}; j++) {
    if (j >= uBlooms) break;
    vec4 g = uBloom[j];
    float d = length(q - g.xy) / g.z;
    float glow = exp(-d * d * 1.6) * 0.5;
    float rim = exp(-pow((d - 1.0) * 5.0, 2.0)) * 0.06;
    col += uBloomC[j] * g.w * (glow + rim);
  }

  col *= uBright;
  float vig = 1.0 - smoothstep(0.5, 1.3, length(p * vec2(0.85, 1.0)));
  col *= mix(0.45, 1.0, vig);
  col = 1.0 - exp(-col * 1.1);

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

  // quiet colours, low pitch → warm, high pitch → cool, all leaning toward moonlight
  const PALETTE = [
    [0.95, 0.78, 0.55], // pale amber
    [0.93, 0.72, 0.66], // blush
    [0.84, 0.72, 0.86], // lilac
    [0.70, 0.76, 0.93], // periwinkle
    [0.64, 0.84, 0.86], // pale teal
    [0.80, 0.88, 0.93], // moonlight
  ];
  function colourFor(hz) {
    const t = Math.max(0, Math.min(1, Math.log2(hz / 70) / 5.2)) * (PALETTE.length - 1);
    const i = Math.min(PALETTE.length - 2, Math.floor(t));
    const f = t - i;
    return PALETTE[i].map((v, k) => v + (PALETTE[i + 1][k] - v) * f);
  }

  // 0 for the deepest gongs, 1 for the highest
  function height(hz) { return Math.max(0, Math.min(1, Math.log2(hz / 60) / 5.5)); }

  class Pool {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
      if (!gl) throw new Error('WebGL is not available');
      this.gl = gl;
      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      this.u = {};
      for (const name of ['uRes', 'uTime', 'uBright', 'uCount', 'uRip', 'uRipB', 'uRipC', 'uBlooms', 'uBloom', 'uBloomC']) {
        this.u[name] = gl.getUniformLocation(prog, name);
      }
      this.rip = new Float32Array(MAX_RIPPLES * 4);
      this.ripB = new Float32Array(MAX_RIPPLES * 4);
      this.ripC = new Float32Array(MAX_RIPPLES * 3);
      this.bloom = new Float32Array(MAX_BLOOMS * 4);
      this.bloomC = new Float32Array(MAX_BLOOMS * 3);

      this.ripples = [];
      this.blooms = [];
      this.gongs = new Map();   // listener gong id → { colour, x, y, nextSwell }
      this.recent = [];         // recent strike spots, so new ones land elsewhere
      this.brightness = 1;
      this.quality = 1;
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

    // somewhere on the water, away from where the last few gongs sounded;
    // deep gongs tend toward the middle, higher ones wander further out
    randomSpot(hz) {
      const a = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
      const halfW = a >= 1 ? 0.5 * a : 0.5;
      const halfH = a >= 1 ? 0.5 : 0.5 / a;
      const reach = 0.55 + 0.4 * height(hz);
      let best = null, bestGap = -1;
      for (let n = 0; n < 12; n++) {
        const ang = Math.random() * Math.PI * 2;
        const rad = Math.sqrt(Math.random()) * reach;
        const x = Math.cos(ang) * rad * (halfW - 0.08);
        const y = Math.sin(ang) * rad * (halfH - 0.08);
        const gap = this.recent.reduce((m, r) => Math.min(m, Math.hypot(r[0] - x, r[1] - y)), 9);
        if (gap > 0.3) return [x, y];
        if (gap > bestGap) { bestGap = gap; best = [x, y]; }
      }
      return best;
    }

    addRipple(x, y, colour, hz, amp, now, crests) {
      const h = height(hz);
      this.ripples.push({
        x, y, t: now, amp, colour, crests,
        spacing: 0.034 - 0.016 * h,
        speed: 0.022 + 0.012 * h,
        fade: 16 - 7 * h,
      });
      if (this.ripples.length > MAX_RIPPLES) {
        let wi = 0, wv = Infinity;
        this.ripples.forEach((r, i) => {
          const v = r.amp * Math.exp(-(now - r.t) / r.fade);
          if (v < wv) { wv = v; wi = i; }
        });
        this.ripples.splice(wi, 1);
      }
    }

    strike(src, amp, now) {
      let g = this.gongs.get(src.id);
      if (!g) {
        g = { colour: colourFor(src.pitch), x: 0, y: 0, nextSwell: 0, bloom: null };
        this.gongs.set(src.id, g);
      }
      const [x, y] = this.randomSpot(src.pitch);
      g.x = x; g.y = y;
      this.recent.push([x, y]);
      if (this.recent.length > 4) this.recent.shift();

      this.addRipple(x, y, g.colour, src.pitch, 0.55 * amp, now, 3);
      const h = height(src.pitch);
      g.bloom = { x, y, t: now, amp, colour: g.colour, size: 0.11 - 0.05 * h, fade: 9 - 4 * h, gong: g, glow: 0 };
      this.blooms.push(g.bloom);
      if (this.blooms.length > MAX_BLOOMS) this.blooms.shift();
      g.nextSwell = now + 3.5;
    }

    // called every frame with the listener's gongs
    step(srcGongs, now, dt) {
      for (const src of srcGongs) {
        const g = this.gongs.get(src.id);
        if (!g) continue;
        const res = Math.max(0, Math.min(1, src.resonance));
        if (g.bloom) g.bloom.res = res;
        // while it keeps ringing, a single faint ring now and then
        if (now >= g.nextSwell && res > 0.15) {
          this.addRipple(g.x, g.y, g.colour, src.pitch, 0.22 * res * (src.amp || 0.6), now, 1);
          g.nextSwell = now + 3.5 + 2.5 * (1 - height(src.pitch));
        }
      }
      for (const b of this.blooms) {
        const age = now - b.t;
        const rise = 1 - Math.exp(-age / 0.9);                 // gathers softly
        const ring = b.gong.bloom === b ? (b.res || 0) * 0.6 : 0;
        const target = b.amp * rise * Math.max(Math.exp(-age / b.fade), ring);
        b.glow += (target - b.glow) * Math.min(1, dt * 2);
      }
      this.blooms = this.blooms.filter((b) => now - b.t < 3 || b.glow > 0.003);
      this.ripples = this.ripples.filter((r) => now - r.t < r.fade * 5);
    }

    forget() {
      this.gongs.clear();
      this.ripples = [];
      this.blooms = [];
      this.recent = [];
    }

    render(now, idleGlow) {
      this.resize();
      const gl = this.gl, u = this.u;
      const n = Math.min(this.ripples.length, MAX_RIPPLES);
      for (let i = 0; i < n; i++) {
        const r = this.ripples[i];
        this.rip.set([r.x, r.y, r.t, r.amp], i * 4);
        this.ripB.set([r.spacing, r.speed, r.fade, r.crests], i * 4);
        this.ripC.set(r.colour, i * 3);
      }
      let bi = 0;
      if (!this.gongs.size) {
        // before anything is heard, a faint glow breathes in the middle
        this.bloom.set([0, 0, 0.12, idleGlow * 0.6], 0);
        this.bloomC.set(PALETTE[0], 0);
        bi = 1;
      }
      for (const b of this.blooms) {
        if (bi >= MAX_BLOOMS) break;
        this.bloom.set([b.x, b.y, b.size, b.glow], bi * 4);
        this.bloomC.set(b.colour, bi * 3);
        bi++;
      }
      gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
      gl.uniform1f(u.uTime, now);
      gl.uniform1f(u.uBright, this.brightness);
      gl.uniform1i(u.uCount, n);
      gl.uniform4fv(u.uRip, this.rip);
      gl.uniform4fv(u.uRipB, this.ripB);
      gl.uniform3fv(u.uRipC, this.ripC);
      gl.uniform1i(u.uBlooms, bi);
      gl.uniform4fv(u.uBloom, this.bloom);
      gl.uniform3fv(u.uBloomC, this.bloomC);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  G.Pool = Pool;
})();
