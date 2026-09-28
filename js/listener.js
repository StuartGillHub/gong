/* Listens to the audio and turns it into gong events.
 *
 * Each frame it takes a spectrum, and looks for sudden rises in energy
 * (spectral flux) — that is a strike. The part of the spectrum that rose
 * is the new gong's "voice": a profile of energy across 32 log-spaced
 * bands. Strikes with similar profiles are grouped into the same gong, so
 * each physical gong in the recording gets its own place and colour.
 * Between strikes, each gong's resonance is tracked by how much of its
 * profile is still sounding.
 */
(function () {
  'use strict';
  const G = (window.G = window.G || {});

  const BANDS = 32;
  const F_LO = 40;
  const F_HI = 4200;
  const CAPTURE_FRAMES = 6;   // frames of rising energy that make up one strike
  const MAX_GONGS = 8;

  class Listener {
    constructor(ctx) {
      this.ctx = ctx;
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 8192;
      this.analyser.smoothingTimeConstant = 0;
      this.analyser.minDecibels = -110;
      this.analyser.maxDecibels = -10;
      const n = this.analyser.frequencyBinCount;
      this.db = new Float32Array(n);
      this.comp = new Float32Array(n);
      this.prev = new Float32Array(n);
      this.binHz = ctx.sampleRate / this.analyser.fftSize;
      this.lo = Math.max(1, Math.floor(F_LO / this.binHz));
      this.hi = Math.min(n - 1, Math.ceil(F_HI / this.binHz));

      // map every bin to a band, and remember each band's centre frequency
      this.bandOf = new Int16Array(n).fill(-1);
      this.bandHz = new Float32Array(BANDS);
      const lf = Math.log2(F_LO), hf = Math.log2(F_HI);
      for (let b = 0; b < BANDS; b++) this.bandHz[b] = Math.pow(2, lf + (hf - lf) * (b + 0.5) / BANDS);
      for (let i = this.lo; i <= this.hi; i++) {
        const f = i * this.binHz;
        this.bandOf[i] = Math.min(BANDS - 1, Math.max(0, Math.floor((Math.log2(f) - lf) / (hf - lf) * BANDS)));
      }

      this.bandNow = new Float32Array(BANDS);
      this.capture = null;
      this.fluxHist = [];
      this.armed = true;
      this.lastStrike = -1;
      this.peakRef = 0.5;       // running reference for strike strength
      this.level = 0;           // overall loudness, 0..1-ish
      this.gongs = [];
      this.nextId = 1;
      this.sensitivity = 1;     // >1 = more strikes detected
      this.variety = 0.5;       // 0..1, higher = more distinct gongs
    }

    get input() { return this.analyser; }

    reset() {
      this.gongs = [];
      this.fluxHist = [];
      this.capture = null;
      this.prev.fill(0);
      this.peakRef = 0.5;
    }

    update(now) {
      const { analyser, db, comp, prev, lo, hi, bandOf, bandNow } = this;
      analyser.getFloatFrequencyData(db);

      bandNow.fill(0);
      let flux = 0, energy = 0;
      const posBands = new Float32Array(BANDS);
      for (let i = lo; i <= hi; i++) {
        const d = db[i];
        const mag = d > -200 ? Math.pow(10, d / 20) : 0;
        const c = Math.log1p(mag * 3000);
        comp[i] = c;
        const rise = c - prev[i];
        const b = bandOf[i];
        if (rise > 0) { flux += rise; posBands[b] += rise; }
        bandNow[b] += c;
        energy += c;
        prev[i] = c;
      }
      flux /= (hi - lo);
      energy /= (hi - lo);
      this.level += (Math.min(1, energy / 2.5) - this.level) * 0.1;

      // adaptive threshold from recent flux
      const hist = this.fluxHist;
      hist.push(flux);
      if (hist.length > 90) hist.shift();
      const sorted = hist.slice().sort((a, b) => a - b);
      const median = sorted[sorted.length >> 1] || 0;
      const mad = sorted.map((v) => Math.abs(v - median)).sort((a, b) => a - b)[sorted.length >> 1] || 0;
      const k = 3.2 / this.sensitivity;
      const minFlux = 0.012 / this.sensitivity;
      const thresh = Math.max(minFlux, median + k * mad + 0.004);

      const strikes = [];

      if (this.capture) {
        const cap = this.capture;
        for (let b = 0; b < BANDS; b++) cap.profile[b] += posBands[b];
        cap.peak = Math.max(cap.peak, flux);
        if (++cap.frames >= CAPTURE_FRAMES) {
          const s = this.finishStrike(cap, now);
          if (s) strikes.push(s);
          this.capture = null;
        }
      } else if (this.armed && flux > thresh && now - this.lastStrike > 0.22) {
        this.armed = false;
        this.lastStrike = now;
        const profile = new Float32Array(BANDS);
        for (let b = 0; b < BANDS; b++) profile[b] = posBands[b];
        this.capture = { profile, peak: flux, frames: 1, t: now };
      }
      if (!this.armed && flux < thresh * 0.6) this.armed = true;
      this.peakRef = Math.max(0.02, this.peakRef * 0.9995);

      // resonance: how much of each gong's voice is still sounding
      for (const g of this.gongs) {
        let e = 0;
        for (let b = 0; b < BANDS; b++) e += g.profile[b] * bandNow[b];
        g.energy = e;
        const ref = Math.max(g.strikeEnergy, 1e-6);
        const r = Math.min(1.2, e / ref);
        // rises quickly, falls gently
        g.resonance += (r - g.resonance) * (r > g.resonance ? 0.25 : 0.03);
        if (now - g.lastStrike > 90) g.resonance *= 0.98;
      }

      return strikes;
    }

    finishStrike(cap, now) {
      const p = cap.profile;
      let norm = 0;
      for (let b = 0; b < BANDS; b++) { p[b] = Math.sqrt(p[b]); norm += p[b] * p[b]; }
      norm = Math.sqrt(norm);
      if (norm < 1e-4) return null;
      for (let b = 0; b < BANDS; b++) p[b] /= norm;

      // strength compared with recent strikes
      this.peakRef = Math.max(this.peakRef, cap.peak);
      const amp = Math.max(0.2, Math.min(1, Math.sqrt(cap.peak / this.peakRef)));

      // find the closest known gong
      let best = null, bestSim = -1;
      for (const g of this.gongs) {
        let s = 0;
        for (let b = 0; b < BANDS; b++) s += g.profile[b] * p[b];
        if (s > bestSim) { bestSim = s; best = g; }
      }
      const need = 0.72 + this.variety * 0.22;   // similarity needed to count as the same gong
      let gong = best;
      if (!best || (bestSim < need && this.gongs.length < MAX_GONGS)) {
        gong = {
          id: this.nextId++,
          profile: p.slice(),
          pitch: 0,
          strikes: 0,
          resonance: 0,
          energy: 0,
          strikeEnergy: 0,
          lastStrike: now,
          lastSeen: now,
        };
        this.gongs.push(gong);
      } else {
        for (let b = 0; b < BANDS; b++) gong.profile[b] = gong.profile[b] * 0.8 + p[b] * 0.2;
        let n = 0;
        for (let b = 0; b < BANDS; b++) n += gong.profile[b] * gong.profile[b];
        n = Math.sqrt(n) || 1;
        for (let b = 0; b < BANDS; b++) gong.profile[b] /= n;
      }
      gong.pitch = this.pitchOf(gong.profile);
      gong.strikes++;
      gong.lastStrike = now;
      gong.lastSeen = now;
      let e = 0;
      for (let b = 0; b < BANDS; b++) e += gong.profile[b] * this.bandNow[b];
      gong.strikeEnergy = Math.max(e, 1e-6);
      gong.resonance = 1;
      gong.amp = amp;
      return { gong, amp };
    }

    // weighted centre of the profile, in Hz (log-averaged)
    pitchOf(profile) {
      let s = 0, w = 0;
      for (let b = 0; b < BANDS; b++) {
        const v = profile[b] * profile[b] * profile[b];
        s += v * Math.log2(this.bandHz[b]);
        w += v;
      }
      return w > 0 ? Math.pow(2, s / w) : 200;
    }
  }

  G.Listener = Listener;
})();
