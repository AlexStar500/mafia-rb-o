/**
 * Upgrade a plain-HTTP visit to HTTPS before the app boots.
 *
 * Firefox marks an HTTP page as "Незащищённое соединение" even when the very
 * same host serves a valid certificate, so the canonical site always answers on
 * HTTPS. Local dev and LAN play stay on HTTP on purpose: localhost, bare IPs and
 * mDNS names usually have no certificate, and redirecting them would break
 * "По IP" rooms.
 */
(function () {
  try {
    if (location.protocol !== "http:") return;
    var host = location.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") return;
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) return;
    if (/\.local$/.test(host) || host.indexOf(":") !== -1) return;
    location.replace("https://" + location.host + location.pathname + location.search + location.hash);
  } catch (error) {
    // Never block the game because of a redirect.
  }
})();
