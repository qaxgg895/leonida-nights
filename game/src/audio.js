// Leonida Nights — procedural sound bank.
// All sounds are synthesized live with the Web Audio API: engine hum,
// police siren, UI blips, gunfire, pickups and stings. No audio files,
// no network, no imports. The game unlocks audio on the first gesture,
// then drives the engine/siren voices and fires one-shots as needed.
export class SoundBank {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this._engineOsc1 = null; this._engineOsc2 = null;
    this._engineFilter = null; this._engineGain = null;
    this._sirenOsc = null; this._sirenGain = null;
    this._sirenTimer = 0; this._sirenHigh = false;
  }
  unlock() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        // Engine: low saw + sub square through a lowpass, silent at rest.
        this._engineFilter = this.ctx.createBiquadFilter();
        this._engineFilter.type = 'lowpass';
        this._engineFilter.frequency.value = 420;
        this._engineGain = this.ctx.createGain();
        this._engineGain.gain.value = 0;
        this._engineFilter.connect(this._engineGain);
        this._engineGain.connect(this.ctx.destination);
        this._engineOsc1 = this.ctx.createOscillator();
        this._engineOsc1.type = 'sawtooth';
        this._engineOsc1.frequency.value = 55;
        this._engineOsc1.connect(this._engineFilter);
        this._engineOsc1.start();
        this._engineOsc2 = this.ctx.createOscillator();
        this._engineOsc2.type = 'square';
        this._engineOsc2.frequency.value = 28;
        this._engineOsc2.connect(this._engineFilter);
        this._engineOsc2.start();
        // Siren: single sine alternating between two pitches.
        this._sirenGain = this.ctx.createGain();
        this._sirenGain.gain.value = 0;
        this._sirenGain.connect(this.ctx.destination);
        this._sirenOsc = this.ctx.createOscillator();
        this._sirenOsc.type = 'sine';
        this._sirenOsc.frequency.value = 700;
        this._sirenOsc.connect(this._sirenGain);
        this._sirenOsc.start();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch (e) { this.ctx = null; }
  }
  setMuted(m) {
    this.muted = !!m;
    if (!this.ctx) return;
    try {
      if (this.muted) {
        if (this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
      } else if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
    } catch (e) { /* mute state is kept locally regardless */ }
  }
  engine(speed01, on) {
    if (!this.ctx || !this._engineGain) return;
    try {
      const s = Math.max(0, Math.min(1, speed01 || 0));
      const target = this.muted ? 0 : (on ? 0.018 + s * 0.05 : 0);
      const t = this.ctx.currentTime;
      this._engineGain.gain.setTargetAtTime(target, t, 0.08);
      const freq = 48 + s * 130;
      if (this._engineOsc1) this._engineOsc1.frequency.setTargetAtTime(freq, t, 0.06);
      if (this._engineOsc2) this._engineOsc2.frequency.setTargetAtTime(freq / 2, t, 0.06);
    } catch (e) { /* engine updates are best-effort */ }
  }
  siren(dt, wanted) {
    if (!this.ctx || !this._sirenGain) return;
    try {
      const t = this.ctx.currentTime;
      if (this.muted || !wanted || wanted <= 0) {
        this._sirenGain.gain.setTargetAtTime(0, t, 0.05);
        return;
      }
      this._sirenTimer += dt || 0;
      if (this._sirenTimer >= 0.42) {
        this._sirenTimer -= 0.42;
        this._sirenHigh = !this._sirenHigh;
        if (this._sirenOsc) this._sirenOsc.frequency.setTargetAtTime(this._sirenHigh ? 920 : 660, t, 0.03);
      }
      this._sirenGain.gain.setTargetAtTime(0.028, t, 0.05);
    } catch (e) { /* siren updates are best-effort */ }
  }
  blip(freq, dur, type, vol) {
    if (!this.ctx || this.muted) return;
    try {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      osc.type = type || 'sine';
      osc.frequency.value = freq || 440;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(vol || 0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + (dur || 0.1));
      osc.connect(gain); gain.connect(this.ctx.destination);
      osc.start(t); osc.stop(t + (dur || 0.1) + 0.02);
    } catch (e) { /* one-shot blips must never throw */ }
  }
  shot() {
    if (!this.ctx || this.muted) return;
    try {
      const dur = 0.12;
      const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const gain = this.ctx.createGain();
      gain.gain.value = 0.22;
      src.connect(gain); gain.connect(this.ctx.destination);
      src.start();
      this.blip(180, 0.09, 'square', 0.08);
    } catch (e) { /* gunfire must never throw */ }
  }
  punch() { this.blip(90, 0.12, 'triangle', 0.16); }
  pickup() {
    this.blip(880, 0.1, 'sine', 0.12);
    setTimeout(() => this.blip(1320, 0.16, 'sine', 0.12), 90);
  }
  sting() {
    [523, 659, 784].forEach((f, i) =>
      setTimeout(() => this.blip(f, 0.22, 'triangle', 0.14), i * 110));
  }
  busted() {
    [392, 311, 233].forEach((f, i) =>
      setTimeout(() => this.blip(f, 0.3, 'sawtooth', 0.08), i * 160));
  }
}
