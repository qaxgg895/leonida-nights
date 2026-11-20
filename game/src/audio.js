// Leonida Nights — all sound is generated with WebAudio. No audio files.
// Engine hum, police siren, gunshot, punch thud, pickup chime, mission sting.
export class SoundBank {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenTimer = 0;
    this.sirenHigh = false;
  }

  // Must be called from a user gesture at least once; safe to call repeatedly.
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      // Engine: two detuned saws through a low-pass, gain follows speed.
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 55;
      const engineOsc2 = this.ctx.createOscillator();
      engineOsc2.type = 'square';
      engineOsc2.frequency.value = 28;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engineOsc.connect(filter);
      engineOsc2.connect(filter);
      filter.connect(this.engineGain);
      this.engineGain.connect(this.ctx.destination);
      this.engineOsc.start();
      engineOsc2.start();
      this.engineOsc2 = engineOsc2;
      // Siren: a sine that flips between two tones.
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenOsc.type = 'sine';
      this.sirenOsc.frequency.value = 700;
      this.sirenGain = this.ctx.createGain();
      this.sirenGain.gain.value = 0;
      this.sirenOsc.connect(this.sirenGain);
      this.sirenGain.connect(this.ctx.destination);
      this.sirenOsc.start();
    } catch (e) {
      this.ctx = null;
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.ctx) this.ctx.suspend().catch(() => {});
    if (!m && this.ctx) this.ctx.resume().catch(() => {});
  }

  // speed01: 0..1. Called every frame while driving.
  engine(speed01, on) {
    if (!this.ctx || !this.engineGain) return;
    const g = this.muted ? 0 : (on ? 0.018 + speed01 * 0.05 : 0);
    this.engineGain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.08);
    const f = 48 + speed01 * 130;
    this.engineOsc.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.1);
    this.engineOsc2.frequency.setTargetAtTime(f / 2, this.ctx.currentTime, 0.1);
  }

  // Flip the siren tone twice a second while wanted > 0.
  siren(dt, wanted) {
    if (!this.ctx || !this.sirenGain) return;
    if (this.muted || wanted <= 0) {
      this.sirenGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
      return;
    }
    this.sirenTimer += dt;
    if (this.sirenTimer > 0.42) {
      this.sirenTimer = 0;
      this.sirenHigh = !this.sirenHigh;
      this.sirenOsc.frequency.setTargetAtTime(this.sirenHigh ? 920 : 660, this.ctx.currentTime, 0.02);
    }
    this.sirenGain.gain.setTargetAtTime(0.028, this.ctx.currentTime, 0.2);
  }

  blip(freq, dur, type, vol) {
    if (!this.ctx || this.muted) return;
    try {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.12, this.ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
      o.connect(g);
      g.connect(this.ctx.destination);
      o.start();
      o.stop(this.ctx.currentTime + dur + 0.02);
    } catch (e) { /* audio is cosmetic; never break the game */ }
  }

  shot() {
    if (!this.ctx || this.muted) return;
    try {
      const len = this.ctx.sampleRate * 0.12;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.value = 0.22;
      src.connect(g);
      g.connect(this.ctx.destination);
      src.start();
    } catch (e) { /* ignore */ }
    this.blip(180, 0.09, 'square', 0.08);
  }

  punch() { this.blip(90, 0.12, 'triangle', 0.16); }
  pickup() { this.blip(880, 0.1, 'sine', 0.12); setTimeout(() => this.blip(1320, 0.16, 'sine', 0.12), 90); }
  sting() {
    // Mission complete: rising three-note sting.
    [523, 659, 784].forEach((f, i) => setTimeout(() => this.blip(f, 0.22, 'triangle', 0.14), i * 110));
  }
  busted() { [392, 311, 233].forEach((f, i) => setTimeout(() => this.blip(f, 0.3, 'sawtooth', 0.08), i * 160)); }
}
