/**
 * Base-aware asset URLs.
 *
 * `index.html` is loaded from the deployment root (`/` locally, `/repo/` on
 * GitHub Pages). Once the router pushes a deep path such as `/room/CODE`, the
 * document URL changes and a bare `assets/...` reference would resolve under
 * the route directory. Everything dynamic must therefore go through `asset()`,
 * which is anchored to this module's own location instead of `location.href`.
 */

const APP_BASE = new URL("../../", import.meta.url);

/**
 * Resolve an app-relative asset path against the deploy base.
 * Absolute URLs, data/blob URLs and already-resolved URLs pass through.
 */
export function asset(path) {
  const value = String(path ?? "").trim();
  if (!value) return "";
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) return value;
  return new URL(value.replace(/^\/+/, ""), APP_BASE).href;
}

/** The app's root URL, always ending with a slash. */
export const ASSET_BASE = APP_BASE.href;
