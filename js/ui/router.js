/**
 * History router.
 *
 * `pushState` does not fire `popstate`, so a navigation is dispatched exactly
 * once: by `navigate()` for programmatic links, and by the `popstate` listener
 * for browser back/forward. A failed guard restores the previous URL without
 * re-rendering anything.
 */

import { normalizeRelayUrl, normalizeRoomCode } from "../core/security.js";

export const ROUTES = Object.freeze([
  "menu",
  "quick",
  "rooms",
  "create",
  "join",
  "roles",
  "rules",
  "server",
  "settings",
  "session",
  "notFound",
]);

const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/i;
const LINKABLE_ROUTES = Object.freeze(["quick", "rooms", "create", "join", "roles", "rules", "server", "settings"]);

function currentLocation() {
  if (typeof location === "undefined") return "/";
  return `${location.pathname}${location.search}`;
}

/** `/repo/` and `/repo/index.html` both live under the `/repo` base. */
export function detectBasePath(pathname = typeof location !== "undefined" ? location.pathname : "/") {
  let path = String(pathname || "/");
  if (path.endsWith("/index.html")) {
    path = path.slice(0, -"index.html".length);
  } else if (!path.endsWith("/")) {
    // A deep link such as /repo/room/ABC has no directory marker. Treat the
    // known route segments as app routes, not as part of the base.
    path = path.replace(/\/(?:room\/[^/]+|quick|rooms|create|join|roles|rules|server|settings)\/?$/, "/");
  }
  return path.replace(/\/+$/, "");
}

function normalizeBase(base) {
  if (typeof base !== "string" || !base || base === "/") return "";
  return `/${base.replace(/^\/+|\/+$/g, "")}`;
}

/**
 * Convert a browser pathname (which may include the GitHub Pages base) into an
 * app-relative path. Trailing slashes and `index.html` are normalized so
 * `/repo/join/`, `/repo/join` and `/repo/index.html` all behave predictably.
 */
export function browserPathToAppPath(pathname = "/") {
  let path = String(pathname || "/");
  if (path.endsWith("/index.html")) path = path.slice(0, -"/index.html".length) || "/";
  path = path.replace(/\/+$/, "") || "/";
  const base = detectBasePath(path);
  let app = path;
  if (base && (path === base || path.startsWith(`${base}/`))) {
    app = path.slice(base.length) || "/";
  }
  return app || "/";
}

/** Turn a path, full URL or named path into a same-origin path + search. */
export function toPath(input) {
  const value = String(input ?? "/").trim() || "/";
  try {
    const url = new URL(value, typeof location !== "undefined" ? location.origin : "http://localhost");
    let path = url.pathname || "/";
    if (!path.startsWith("/")) path = `/${path}`;
    path = path.replace(/\/{2,}/g, "/");
    if (path.length > 1) path = path.replace(/\/+$/, "");
    return `${path}${url.search}`;
  } catch {
    return "/";
  }
}

export function parseRoute(input = currentLocation()) {
  const path = toPath(input);
  const url = new URL(path, "http://local.invalid");
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const query = Object.fromEntries(url.searchParams.entries());

  const simple = {
    "/": "menu",
    "/quick": "quick",
    "/rooms": "rooms",
    "/create": "create",
    "/join": "join",
    "/roles": "roles",
    "/rules": "rules",
    "/server": "server",
    "/settings": "settings",
  };
  if (simple[pathname]) return { name: simple[pathname], path, params: {}, query };

  const room = pathname.match(/^\/room\/([^/]+)$/);
  if (room) {
    const code = decodeURIComponent(room[1]).toUpperCase();
    return { name: "session", path, params: { code }, query };
  }

  return { name: "notFound", path, params: { path: pathname }, query };
}

export function sessionPath(code) {
  return `/room/${encodeURIComponent(String(code ?? "").toUpperCase())}`;
}

/**
 * Build the canonical join query from a legacy link (`?code=`, `?room=`) while
 * keeping only the connection settings the join screen understands.
 */
function joinRedirectQuery(search = "") {
  const params = new URLSearchParams(search || "");
  const code = normalizeRoomCode(params.get("room") ?? params.get("code") ?? "");
  if (!code) return "";
  const relay = normalizeRelayUrl(params.get("relay") ?? "");
  const requestedMode = params.get("mode");
  const mode =
    requestedMode === "local" || requestedMode === "online" || requestedMode === "lan" ? requestedMode : "";
  const query = new URLSearchParams({ code });
  if (relay) query.set("relay", relay);
  if (mode) query.set("mode", mode);
  return query.toString();
}

/**
 * Legacy invite links (`/?room=CODE`, `/?code=CODE`) are redirected to the join
 * screen. The join screen itself must not be rewritten: its query carries the
 * connection mode and relay, which would otherwise be lost on boot.
 */
export function bootJoinRedirect(pathname = "/", search = "") {
  const path = String(pathname || "/").replace(/\/+$/, "") || "/";
  if (/\/join$/.test(path)) return "";
  const query = joinRedirectQuery(search);
  return query ? `/join?${query}` : "";
}

/**
 * Static hosting (GitHub Pages in particular) has no SPA fallback: a fresh
 * request for `/join` or `/room/ABC` never reaches `index.html`, and relative
 * shell assets would resolve under the deep directory. The 404 page and dev
 * server therefore bounce such URLs to the real document root with a small
 * query marker; boot restores the pretty URL with `history.replaceState`.
 *
 * Returns an app-root URL (`/?code=...`) or an empty string when the path is
 * already servable (the root) or is not a known app route.
 */
export function deepLinkRootRedirect(pathname = "/", search = "") {
  const appPath = browserPathToAppPath(pathname);
  if (appPath === "/") return "";
  const route = appPath.slice(1);
  const params = new URLSearchParams(search || "");
  if (/^room\/[^/]+$/i.test(route)) {
    let code = "";
    try {
      code = normalizeRoomCode(decodeURIComponent(route.slice(5)));
    } catch {
      return "/";
    }
    if (!code) return "/";
    const mode = params.get("mode");
    // Solo/spectator sessions are deliberately not restorable after a reload.
    if (mode === "solo" || mode === "spectate") return "/";
    const query = new URLSearchParams({ room: code });
    const relay = normalizeRelayUrl(params.get("relay") ?? "");
    if (relay) query.set("relay", relay);
    if (mode === "local" || mode === "online" || mode === "lan") query.set("mode", mode);
    return `/?${query.toString()}`;
  }
  if (route === "join") {
    const query = joinRedirectQuery(search);
    if (query) return `/?${query}`;
    const fallback = new URLSearchParams({ route: "join" });
    const relay = normalizeRelayUrl(params.get("relay") ?? "");
    const mode = params.get("mode");
    if (relay) fallback.set("relay", relay);
    if (mode === "local" || mode === "online" || mode === "lan") fallback.set("mode", mode);
    return `/?${fallback.toString()}`;
  }
  if (LINKABLE_ROUTES.includes(route)) {
    params.set("route", route);
    return `/?${params.toString()}`;
  }
  return "";
}

/**
 * Restore the in-app 404 screen for an unknown static path. The 404 page and
 * the service worker bounce such paths to the document root with
 * `?notfound=/original/path`, because a static host cannot serve the shell from
 * a deep directory. Only same-origin paths under the current base are accepted.
 */
export function bootNotFoundRedirect(pathname = "/", search = "") {
  if (browserPathToAppPath(pathname) !== "/") return "";
  const params = new URLSearchParams(search || "");
  const raw = String(params.get("notfound") ?? "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "";
  let original;
  try {
    original = new URL(raw, "http://local.invalid");
  } catch {
    return "";
  }
  if (original.origin !== "http://local.invalid") return "";
  let app = original.pathname.replace(/\/+$/, "") || "/";
  const base = detectBasePath(pathname);
  if (base && (app === base || app.startsWith(`${base}/`))) {
    app = app.slice(base.length) || "/";
  }
  if (app === "/" || app === "/index.html") return "";
  return app;
}

/** Restore a simple screen from the `?route=` marker written by the 404 page. */
export function bootRouteRedirect(pathname = "/", search = "") {
  if (browserPathToAppPath(pathname) !== "/") return "";
  const params = new URLSearchParams(search || "");
  const route = String(params.get("route") ?? "").toLowerCase();
  if (!LINKABLE_ROUTES.includes(route)) return "";
  params.delete("route");
  const rest = params.toString();
  return `/${route}${rest ? `?${rest}` : ""}`;
}

/** Single boot entry point for legacy invites and static-host deep links. */
export function bootRedirect(pathname = "/", search = "") {
  return (
    bootJoinRedirect(pathname, search) ||
    bootRouteRedirect(pathname, search) ||
    bootNotFoundRedirect(pathname, search)
  );
}


export class Router {
  constructor({ onRoute, guard = null, base = null } = {}) {
    this.onRoute = typeof onRoute === "function" ? onRoute : () => {};
    this.guard = typeof guard === "function" ? guard : null;
    this.base = normalizeBase(base ?? detectBasePath());
    this.committed = currentLocation();
    this.started = false;
    this._onPop = () => this._handlePop();
    this._onClick = (event) => this._handleClick(event);
  }

  /** Strip the deployment base from a same-origin path. */
  appPath(input = currentLocation()) {
    const path = toPath(input);
    if (!this.base) return path || "/";
    const url = new URL(path, "http://local.invalid");
    let pathname = url.pathname;
    if (pathname === this.base) pathname = "/";
    else if (pathname.startsWith(`${this.base}/`)) pathname = pathname.slice(this.base.length);
    const search = url.search;
    return `${pathname || "/"}${search}`;
  }

  /** Add the deployment base for history / share URLs. */
  browserPath(input = "/") {
    const appPath = toPath(input);
    if (!this.base) return appPath;
    const url = new URL(appPath, "http://local.invalid");
    const pathname = url.pathname === "/" ? `${this.base}/` : `${this.base}${url.pathname}`;
    return `${pathname}${url.search}`;
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.committed = currentLocation();
    if (typeof window !== "undefined") {
      window.addEventListener("popstate", this._onPop);
      document.addEventListener("click", this._onClick);
    }
    this.onRoute(parseRoute(this.appPath(this.committed)), { initial: true, path: this.appPath(this.committed) });
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    window.removeEventListener("popstate", this._onPop);
    document.removeEventListener("click", this._onClick);
  }

  _handleClick(event) {
    if (!(event.target instanceof Element)) return;
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest("a[data-link]");
    if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
    const href = link.getAttribute("href");
    if (!href || !href.startsWith("/")) return;
    event.preventDefault();
    void this.navigate(href);
  }

  async _handlePop() {
    const target = currentLocation();
    if (target === this.committed) return;
    if (this.guard) {
      let allowed = false;
      try {
        allowed = await this.guard(parseRoute(this.appPath(target)), {
          from: parseRoute(this.appPath(this.committed)),
          pop: true,
        });
      } catch (error) {
        console.error("[router] guard", error);
      }
      if (!allowed) {
        this._restore();
        return;
      }
    }
    this.committed = target;
    this.onRoute(parseRoute(this.appPath(target)), { pop: true, path: this.appPath(target) });
  }

  _restore() {
    try {
      history.replaceState(history.state ?? {}, "", this.committed);
    } catch {
      // A non-navigable URL is better than a broken app.
    }
  }

  async navigate(input, { replace = false, force = false } = {}) {
    const appTarget = this.appPath(input);
    const target = this.browserPath(appTarget);
    if (target === this.committed && !replace) {
      return true;
    }
    if (!force && this.guard) {
      let allowed = false;
      try {
        allowed = await this.guard(parseRoute(appTarget), {
          from: parseRoute(this.appPath(this.committed)),
        });
      } catch (error) {
        console.error("[router] guard", error);
      }
      if (!allowed) {
        this._restore();
        return false;
      }
    }
    try {
      if (replace) history.replaceState({}, "", target);
      else history.pushState({}, "", target);
    } catch {
      return false;
    }
    this.committed = target;
    this.onRoute(parseRoute(appTarget), { path: appTarget });
    return true;
  }

  /** Replace the URL without asking the guard. Used after a session is closed. */
  replace(input) {
    return this.navigate(input, { replace: true, force: true });
  }
}

export function isRoomCode(value) {
  return typeof value === "string" && CODE_RE.test(value);
}
