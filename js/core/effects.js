/**
 * Visual effects budget.
 *
 * The noir scene used to animate three full-screen layers (rain, fog, moon)
 * plus backdrop-filter panels. That looked good on paper and cost 30–40 fps on
 * ordinary laptops and phones, so motion is now opt-in and the renderer may
 * downgrade itself when the device cannot keep up.
 */

export const EFFECT_MODES = Object.freeze(["auto", "full", "low"]);

export function normalizeEffectsMode(value) {
  return EFFECT_MODES.includes(value) ? value : "auto";
}

/** Apply the class flags the CSS reads. `lite` only matters for `auto`. */
export function applyEffects(settings = {}, { lite = false } = {}) {
  if (typeof document === "undefined") return;
  const mode = normalizeEffectsMode(settings.effects);
  const root = document.documentElement;
  const low = mode === "low" || (mode === "auto" && lite);
  root.classList.toggle("fx-full", mode === "full" && !settings.reducedMotion);
  root.classList.toggle("fx-lite", low || settings.reducedMotion === true);
  root.dataset.effects = mode;
}

/**
 * Measure the real frame rate for a moment. Returns 0 when the tab is hidden
 * or the browser throttles timers — callers must treat that as "unknown".
 */
export function probeFrameRate(duration = 1400) {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== "function" || (typeof document !== "undefined" && document.hidden)) {
      resolve(0);
      return;
    }
    const frames = [];
    let last = 0;
    let start = 0;
    const tick = (now) => {
      if (!start) {
        start = now;
        last = now;
        requestAnimationFrame(tick);
        return;
      }
      frames.push(now - last);
      last = now;
      if (now - start < duration) {
        requestAnimationFrame(tick);
        return;
      }
      const total = frames.reduce((sum, ms) => sum + ms, 0);
      const fps = total > 0 ? Math.round((frames.length * 1000) / total) : 0;
      resolve(frames.length > 8 ? fps : 0);
    };
    requestAnimationFrame(tick);
  });
}

/**
 * Pick the effects budget. `auto` and `low` both stay on the minimum budget;
 * `full` is the only mode that enables the animated layers. `auto` no longer
 * probes the frame rate and upgrades — always-low keeps the render stable on
 * Chromium and is far lighter on Gecko (Firefox).
 */
export function autoTuneEffects(settings = {}, { onLite } = {}) {
  const mode = normalizeEffectsMode(settings.effects);
  applyEffects(settings, { lite: mode !== "full" });
  if (mode !== "full") onLite?.();
}
