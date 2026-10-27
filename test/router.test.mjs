import test from "node:test";
import assert from "node:assert/strict";
import {
  bootJoinRedirect,
  bootNotFoundRedirect,
  bootRedirect,
  bootRouteRedirect,
  browserPathToAppPath,
  deepLinkRootRedirect,
  detectBasePath,
  parseRoute,
  sessionPath,
} from "../js/ui/router.js";

test("legacy invite links redirect to the join screen", () => {
  assert.equal(bootJoinRedirect("/", "?room=abc234"), "/join?code=ABC234");
  assert.equal(
    bootJoinRedirect("/repo/", "?code=ABC234&relay=ws%3A%2F%2F127.0.0.1%3A8081%2Fws&mode=local"),
    "/join?code=ABC234&relay=ws%3A%2F%2F127.0.0.1%3A8081%2Fws&mode=local",
  );
  assert.equal(bootJoinRedirect("/", "?room=ABC234&mode=alien"), "/join?code=ABC234");
  assert.equal(bootJoinRedirect("/", ""), "");
});

test("the join screen keeps its own query on boot", () => {
  assert.equal(bootJoinRedirect("/join", "?code=ABC234&mode=local"), "");
  assert.equal(bootJoinRedirect("/repo/join/", "?code=ABC234&mode=online"), "");
  assert.equal(bootJoinRedirect("/repo/join/", "?code=ABC234&mode=lan"), "");
});

test("browser paths are normalized against the deployment base", () => {
  assert.equal(detectBasePath("/repo/"), "/repo");
  assert.equal(detectBasePath("/repo/index.html"), "/repo");
  assert.equal(detectBasePath("/repo/join"), "/repo");
  assert.equal(detectBasePath("/repo/room/ABC234"), "/repo");
  assert.equal(detectBasePath("/"), "");
  assert.equal(browserPathToAppPath("/"), "/");
  assert.equal(browserPathToAppPath("/index.html"), "/");
  assert.equal(browserPathToAppPath("/repo/"), "/");
  assert.equal(browserPathToAppPath("/repo/index.html"), "/");
  assert.equal(browserPathToAppPath("/repo/join/"), "/join");
  assert.equal(browserPathToAppPath("/repo/room/ABC234"), "/room/ABC234");
  assert.equal(browserPathToAppPath("/rooms"), "/rooms");
});

test("deep links bounce through the static document root", () => {
  assert.equal(deepLinkRootRedirect("/repo/", ""), "");
  assert.equal(deepLinkRootRedirect("/repo/index.html", ""), "");
  assert.equal(deepLinkRootRedirect("/repo/join", "?code=abc234&mode=local"), "/?code=ABC234&mode=local");
  assert.equal(deepLinkRootRedirect("/repo/join/", "?code=abc234"), "/?code=ABC234");
  assert.equal(deepLinkRootRedirect("/repo/join/", "?code=abc234&mode=lan"), "/?code=ABC234&mode=lan");
  assert.equal(deepLinkRootRedirect("/join", ""), "/?route=join");
  assert.equal(deepLinkRootRedirect("/repo/room/abc234", ""), "/?room=ABC234");
  assert.equal(deepLinkRootRedirect("/repo/room/abc234", "?relay=ws%3A%2F%2F127.0.0.1%3A8081%2Fws&mode=online"), "/?room=ABC234&relay=ws%3A%2F%2F127.0.0.1%3A8081%2Fws&mode=online");
  assert.equal(deepLinkRootRedirect("/repo/room/abc234", "?mode=solo"), "/");
  assert.equal(deepLinkRootRedirect("/repo/room/abc234", "?mode=spectate"), "/");
  assert.equal(deepLinkRootRedirect("/repo/rooms", ""), "/?route=rooms");
  assert.equal(deepLinkRootRedirect("/repo/not-a-route", ""), "");
});

test("the route marker restores the original screen once the shell boots", () => {
  assert.equal(bootRouteRedirect("/repo/", "?route=rooms"), "/rooms");
  assert.equal(bootRouteRedirect("/repo/index.html", "?route=roles"), "/roles");
  assert.equal(bootRouteRedirect("/repo/", "?route=../../evil"), "");
  assert.equal(bootRedirect("/repo/", "?route=rooms"), "/rooms");
  assert.equal(bootRedirect("/repo/", "?code=abc234"), "/join?code=ABC234");
  assert.equal(bootRedirect("/repo/join", "?code=abc234"), "");
  assert.equal(bootRedirect("/repo/", ""), "");
});

test("unknown deep links restore the in-app 404 screen", () => {
  assert.equal(bootNotFoundRedirect("/", "?notfound=%2Fnope"), "/nope");
  assert.equal(bootNotFoundRedirect("/repo/", "?notfound=%2Frepo%2Fnope"), "/nope");
  assert.equal(bootNotFoundRedirect("/repo/", "?notfound=%2Frepo%2Fdeep%2Fpath"), "/deep/path");
  assert.equal(bootNotFoundRedirect("/repo/index.html", "?notfound=%2Frepo%2Fnope"), "/nope");
  assert.equal(bootNotFoundRedirect("/", "?notfound=%2F"), "");
  assert.equal(bootNotFoundRedirect("/", "?notfound=%2Findex.html"), "");
  assert.equal(bootNotFoundRedirect("/", "?notfound=%2F%2Fevil.example"), "");
  assert.equal(bootNotFoundRedirect("/", "?notfound=https%3A%2F%2Fevil.example"), "");
  assert.equal(bootNotFoundRedirect("/", "?notfound=..%2Fescape"), "");
  assert.equal(bootNotFoundRedirect("/join", "?notfound=%2Fnope"), "");
  assert.equal(bootRedirect("/repo/", "?notfound=%2Frepo%2Fnope"), "/nope");
  assert.equal(parseRoute(bootNotFoundRedirect("/repo/", "?notfound=%2Frepo%2Fnope")).name, "notFound");
});


test("routes and session paths are parsed consistently", () => {
  assert.equal(parseRoute("/").name, "menu");
  assert.equal(parseRoute("/join?code=ABC234&mode=local").query.mode, "local");
  const route = parseRoute(sessionPath("abc234"));
  assert.equal(route.name, "session");
  assert.equal(route.params.code, "ABC234");
});
