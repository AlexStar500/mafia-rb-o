/**
 * Music + generated SFX.
 *
 * The two music beds are the author's own tracks (assets/audio). Sound effects
 * are synthesised with WebAudio, so the game ships without extra binaries.
 * Nothing plays before the first user gesture, as browsers require.
 */

import { asset } from "../core/assets.js";

const SCENES = Object.freeze({
  menu: "night",
  lobby: "night",
  night: "night",
  dawn: "dayLoop",
  discussion: "dayLoop",
  voting: "dayLoop",
  verdict: "dayLoop",
  lastWords: "dayLoop",
  ended: "night",
  silent: null,
});

function canPlayOgg() {
  try {
    const probe = document.createElement("audio");
    return Boolean(probe.canPlayType('audio/ogg; codecs="vorbis"'));
  } catch {
    return false;
  }
}

export class AudioManager {
  constructor(settings = {}) {
    this.settings = { ...settings };
    this.unlocked = false;
    this.scene = "menu";
    this.pendingScene = null;
    this.ctx = null;
    this.master = null;
    this.sfxGain = null;
    this.tracks = new Map();
    this._fades = new Map();
    this._hidden = false;
    this._built = false;
    this._activeTrackName = null;
    this._installPath = canPlayOgg() ? "ogg" : "mp3";
    this._unlockHandler = () => this.unlock();
    this._bindUnlock();
    document.addEventListener("visibilitychange", () => this._onVisibility());
  }

  _bindUnlock() {
    const events = ["pointerdown", "keydown", "touchstart"];
    const handler = () => this.unlock();
    for (const event of events) {
      window.addEventListener(event, handler, { once: true, passive: true });
    }
    this._unlockHandler = handler;
  }

  _buildTracks() {
    if (this._built) return;
    this._built = true;
    const ext = this._installPath;
    for (const name of ["night", "dayLoop"]) {
      const audio = new Audio(asset(`assets/audio/${name}.${ext}`));
      // Both beds loop. The day bed is the full track; the short `day` sting
      // below marks the exact moment the city wakes up.
      audio.loop = true;
      audio.preload = "auto";
      audio.volume = 0;
      audio.setAttribute("playsinline", "");
      this.tracks.set(name, audio);
    }
    // One-shot dawn sting, never looped under the discussion.
    this.sting = new Audio(asset(`assets/audio/day.${ext}`));
    this.sting.loop = false;
    this.sting.preload = "auto";
    this.sting.volume = 0;
    this.sting.setAttribute("playsinline", "");
  }

  _playSting() {
    if (!this.sting || this._hidden || this.settings.muted) return;
    try {
      this.sting.currentTime = 0;
      this.sting.volume = Math.min(1, this._musicVolume() + 0.08);
      this.sting.play().catch(() => {});
    } catch {
      // Ignored: the sting is decoration.
    }
  }

  async unlock() {
    if (this.unlocked) return;
    this._buildTracks();
    this.unlocked = true;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx && !this.ctx) {
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.9;
        this.sfxGain = this.ctx.createGain();
        this.sfxGain.gain.value = this._sfxVolume();
        this.sfxGain.connect(this.master);
        this.master.connect(this.ctx.destination);
      }
      await this.ctx?.resume?.();
    } catch {
      // Audio is progressive enhancement.
    }
    this.setScene(this.pendingScene ?? this.scene, { force: true });
    this.pendingScene = null;
  }

  _musicVolume() {
    if (this.settings.muted) return 0;
    return Math.max(0, Math.min(1, Number(this.settings.music) || 0)) * 0.72;
  }

  _sfxVolume() {
    if (this.settings.muted) return 0;
    return Math.max(0, Math.min(1, Number(this.settings.sfx) || 0)) * 0.7;
  }

  setSettings(settings) {
    const previous = this.settings;
    this.settings = { ...this.settings, ...settings };
    if (this.sfxGain && this.ctx) {
      this.sfxGain.gain.setTargetAtTime(this._sfxVolume(), this.ctx.currentTime, 0.05);
    }
    if (previous.muted !== this.settings.muted || previous.music !== this.settings.music) {
      this.setScene(this.scene, { force: true });
    }
  }

  setScene(scene, { force = false } = {}) {
    if (!scene) return;
    if (scene === this.scene && !force) return;
    this.scene = scene;
    if (!this.unlocked) {
      this.pendingScene = scene;
      return;
    }
    this._buildTracks();
    const wanted = SCENES[scene] ?? null;
    const trackChanged = wanted !== this._activeTrackName;
    if (trackChanged && scene === "dawn") this._playSting();
    for (const [name, audio] of this.tracks) {
      const isWanted = name === wanted;
      if (isWanted && trackChanged) {
        try {
          audio.currentTime = 0;
        } catch {
          // Some browsers throw before metadata is ready; play() will retry.
        }
      }
      const target = isWanted && !this._hidden ? this._musicVolume() : 0;
      this._fade(audio, target, force ? 220 : 1600);
      if (isWanted && !this._hidden && audio.paused && !audio.ended) {
        audio.play().catch(() => {
          // Autoplay may still be blocked; the next gesture retries.
        });
      }
    }
    this._activeTrackName = wanted;
  }

  _fade(audio, target, duration = 1200) {
    const existing = this._fades.get(audio);
    if (existing) clearInterval(existing);
    const start = audio.volume;
    const diff = target - start;
    if (Math.abs(diff) < 0.005 && target === 0) {
      audio.volume = 0;
      audio.pause();
      return;
    }
    if (target > 0 && audio.paused && !this._hidden && !audio.ended) {
      audio.play().catch(() => {});
    }
    const started = performance.now();
    const timer = setInterval(() => {
      const t = Math.min(1, (performance.now() - started) / Math.max(40, duration));
      const value = start + diff * t;
      audio.volume = Math.max(0, Math.min(1, value));
      if (t >= 1) {
        clearInterval(timer);
        this._fades.delete(audio);
        if (audio.volume <= 0.005) {
          audio.pause();
          audio.volume = 0;
        }
      }
    }, 45);
    this._fades.set(audio, timer);
  }

  _onVisibility() {
    this._hidden = document.hidden === true;
    for (const audio of this.tracks.values()) {
      if (this._hidden) audio.pause();
    }
    if (this._hidden) this.sting?.pause();
    if (!this._hidden) this.setScene(this.scene, { force: true });
  }

  toggleMute() {
    this.settings.muted = !this.settings.muted;
    this.setScene(this.scene, { force: true });
    return this.settings.muted;
  }

  // -----------------------------------------------------------------------
  // SFX
  // -----------------------------------------------------------------------

  _tone({ freq = 440, to = freq, type = "sine", duration = 0.12, gain = 0.12, delay = 0, curve = "exp" }) {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (curve === "exp" && to > 0) osc.frequency.exponentialRampToValueAtTime(to, now + duration);
    else osc.frequency.linearRampToValueAtTime(to, now + duration);
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), now + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(env);
    env.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  _noise({ duration = 0.2, gain = 0.08, cutoff = 900, delay = 0, q = 0.8 } = {}) {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime + delay;
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = cutoff;
    filter.Q.value = q;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(gain, now);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter);
    filter.connect(env);
    env.connect(this.sfxGain);
    source.start(now);
  }

  play(name) {
    if (!this.unlocked || !this.ctx) return;
    if (this.settings.muted) return;
    switch (name) {
      case "click":
        this._tone({ freq: 560, to: 480, type: "triangle", duration: 0.05, gain: 0.06 });
        break;
      case "select":
        this._tone({ freq: 420, to: 620, type: "sine", duration: 0.09, gain: 0.07 });
        break;
      case "back":
        this._tone({ freq: 400, to: 300, type: "sine", duration: 0.08, gain: 0.05 });
        break;
      case "join":
        this._tone({ freq: 330, type: "sine", duration: 0.12, gain: 0.08 });
        this._tone({ freq: 495, type: "sine", duration: 0.18, gain: 0.07, delay: 0.08 });
        break;
      case "leave":
        this._tone({ freq: 380, to: 250, type: "sine", duration: 0.16, gain: 0.06 });
        break;
      case "message":
        this._tone({ freq: 820, to: 760, type: "triangle", duration: 0.045, gain: 0.035 });
        break;
      case "error":
        this._tone({ freq: 190, to: 150, type: "square", duration: 0.16, gain: 0.05 });
        break;
      case "vote":
        this._tone({ freq: 300, to: 220, type: "triangle", duration: 0.1, gain: 0.08 });
        this._noise({ duration: 0.08, gain: 0.03, cutoff: 1200 });
        break;
      case "start":
        this._tone({ freq: 110, to: 82, type: "sawtooth", duration: 0.55, gain: 0.1 });
        this._tone({ freq: 220, to: 196, type: "sine", duration: 0.6, gain: 0.07 });
        this._noise({ duration: 0.5, gain: 0.04, cutoff: 500 });
        break;
      case "night":
        this._tone({ freq: 220, to: 110, type: "sine", duration: 1.1, gain: 0.06 });
        this._noise({ duration: 0.9, gain: 0.025, cutoff: 380 });
        break;
      case "dawn":
        this._tone({ freq: 392, type: "sine", duration: 0.4, gain: 0.06 });
        this._tone({ freq: 523, type: "sine", duration: 0.5, gain: 0.05, delay: 0.12 });
        break;
      case "gavel":
        this._noise({ duration: 0.14, gain: 0.14, cutoff: 700 });
        this._tone({ freq: 140, to: 70, type: "sine", duration: 0.18, gain: 0.12 });
        break;
      case "death":
        this._tone({ freq: 180, to: 55, type: "sawtooth", duration: 0.7, gain: 0.08 });
        this._noise({ duration: 0.5, gain: 0.05, cutoff: 420 });
        break;
      case "win":
        [392, 494, 587, 784].forEach((freq, index) => {
          this._tone({ freq, type: "triangle", duration: 0.42, gain: 0.06, delay: index * 0.11 });
        });
        break;
      case "lose":
        [330, 277, 220].forEach((freq, index) => {
          this._tone({ freq, to: freq * 0.95, type: "sawtooth", duration: 0.55, gain: 0.05, delay: index * 0.16 });
        });
        break;
      case "jester":
        [523, 659, 784, 1046].forEach((freq, index) => {
          this._tone({ freq, type: "square", duration: 0.18, gain: 0.035, delay: index * 0.09 });
        });
        break;
      default:
        break;
    }
  }
}

export const AUDIO_SCENES = SCENES;
