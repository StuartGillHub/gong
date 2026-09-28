/* Demo gongs, synthesised so the pool can be tried without any music.
 * Each gong is a handful of inharmonic partials that bloom and fade at
 * different rates, with a slight detune for a slow shimmering beat.
 */
(function () {
  'use strict';
  const G = (window.G = window.G || {});

  const GONGS = [
    { f: 58, ratios: [1, 1.49, 2.03, 2.47, 2.92, 3.61, 4.37, 5.1], decay: 16, weight: 3 },
    { f: 104, ratios: [1, 1.52, 1.97, 2.61, 3.13, 3.98, 4.8], decay: 12, weight: 2 },
    { f: 187, ratios: [1, 1.58, 2.12, 2.76, 3.4, 4.21], decay: 9, weight: 2 },
    { f: 331, ratios: [1, 1.6, 2.33, 2.95, 3.7], decay: 7, weight: 1.5 },
    { f: 590, ratios: [1, 1.71, 2.4, 3.02], decay: 5, weight: 1 },
  ];

  class Demo {
    constructor(ctx, out) {
      this.ctx = ctx;
      this.out = ctx.createGain();
      this.out.gain.value = 0.5;
      // a little space around the gongs
      const delay = ctx.createDelay(1);
      delay.delayTime.value = 0.31;
      const fb = ctx.createGain();
      fb.gain.value = 0.35;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1800;
      this.out.connect(out);
      this.out.connect(delay);
      delay.connect(lp);
      lp.connect(fb);
      fb.connect(delay);
      lp.connect(out);
      this.timer = null;
      this.running = false;
    }

    strike(i, vel) {
      const ctx = this.ctx;
      const g = GONGS[i];
      const t = ctx.currentTime + 0.02;
      g.ratios.forEach((ratio, k) => {
        const f = g.f * ratio * (1 + (Math.random() - 0.5) * 0.004);
        const amp = vel * 0.22 / Math.pow(k + 1, 0.7);
        const bloom = 0.01 + k * 0.05;                // higher partials swell in later
        const decay = g.decay / (1 + k * 0.35);
        for (const detune of [-0.8, 0.8]) {
          const o = ctx.createOscillator();
          o.frequency.setValueAtTime(f * 1.004, t);
          o.frequency.exponentialRampToValueAtTime(f, t + 1.5);
          o.detune.value = detune * (2 + k);
          const e = ctx.createGain();
          e.gain.setValueAtTime(0, t);
          e.gain.linearRampToValueAtTime(amp * 0.5, t + bloom);
          e.gain.setTargetAtTime(0, t + bloom, decay / 3);
          o.connect(e);
          e.connect(this.out);
          o.start(t);
          o.stop(t + bloom + decay * 1.6);
        }
      });
      // the soft thud of the mallet
      const n = ctx.createBufferSource();
      const len = Math.floor(ctx.sampleRate * 0.12);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let j = 0; j < len; j++) d[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / len, 4);
      n.buffer = buf;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = g.f * 4;
      const ng = ctx.createGain();
      ng.gain.value = vel * 0.25;
      n.connect(f);
      f.connect(ng);
      ng.connect(this.out);
      n.start(t);
    }

    pick() {
      const total = GONGS.reduce((s, g) => s + g.weight, 0);
      let r = Math.random() * total;
      for (let i = 0; i < GONGS.length; i++) {
        r -= GONGS[i].weight;
        if (r <= 0) return i;
      }
      return 0;
    }

    start() {
      if (this.running) return;
      this.running = true;
      this.strike(0, 0.9);
      const next = () => {
        if (!this.running) return;
        this.strike(this.pick(), 0.45 + Math.random() * 0.55);
        this.timer = setTimeout(next, 2800 + Math.random() * 5200);
      };
      this.timer = setTimeout(next, 4000);
    }

    stop() {
      this.running = false;
      clearTimeout(this.timer);
    }
  }

  G.Demo = Demo;
})();
