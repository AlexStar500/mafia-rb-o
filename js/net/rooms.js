import { fetchOnlineRooms } from "./online.js";
import { listLocalRooms } from "./local.js";

export function roomHasSpace(room) {
  return Number(room.players) < Number(room.maxPlayers);
}

export function roomIsJoinable(room) {
  if (!room) return false;
  if (room.status === "lobby") return roomHasSpace(room);
  return room.status === "playing";
}

export function roomStatusText(room) {
  if (!room) return "—";
  if (room.spectatorOnly) return "Наблюдение";
  if (room.status === "lobby") return roomHasSpace(room) ? "Открыта" : "Заполнена";
  if (room.status === "playing") return "Идёт игра";
  return "Завершена";
}

export function roomModeText(room) {
  if (!room) return "";
  if (room.spectatorOnly) return "Боты";
  if (room.lan) return "По IP";
  return room.source === "online" ? "Онлайн" : "Это устройство";
}

function sortRooms(rooms) {
  return [...rooms].sort((a, b) => {
    const statusRank = (room) => (room.status === "lobby" ? 0 : room.status === "playing" ? 1 : 2);
    return (
      statusRank(a) - statusRank(b) ||
      Number(b.humans) - Number(a.humans) ||
      Number(b.updatedAt) - Number(a.updatedAt)
    );
  });
}

/**
 * Merge same-browser rooms with relay rooms. Online failures are reported but
 * never hide local rooms — the game must remain playable on a static host.
 * `onLocal` fires before the relay request so the first rooms paint instantly.
 */
export async function listAllRooms({ relayUrl = "", includeLocal = true, timeout = 4000, onLocal = null } = {}) {
  const local = includeLocal ? listLocalRooms() : [];
  if (typeof onLocal === "function") {
    onLocal({
      rooms: sortRooms(local),
      localCount: local.length,
      onlineCount: 0,
      onlineError: null,
      relayEnabled: Boolean(relayUrl),
    });
  }
  let online = [];
  let onlineError = null;
  if (relayUrl) {
    try {
      online = await fetchOnlineRooms(relayUrl, { timeout });
    } catch (error) {
      onlineError = String(error?.message ?? "Relay недоступен.");
    }
  }
  const seen = new Set();
  const rooms = [...online, ...local].filter((room) => {
    if (!room?.code) return false;
    const key = `${room.source}:${room.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    rooms: sortRooms(rooms),
    localCount: local.length,
    onlineCount: online.length,
    onlineError,
    relayEnabled: Boolean(relayUrl),
  };
}

export function quickMatchRoom(rooms, { maxPlayers = 20 } = {}) {
  const candidates = (Array.isArray(rooms) ? rooms : [])
    .filter((room) => room.public && room.status === "lobby" && roomHasSpace(room))
    .filter((room) => Number(room.players) < maxPlayers)
    .sort((a, b) => {
      const quick = Number(b.quick === true) - Number(a.quick === true);
      const humans = Number(b.humans) - Number(a.humans);
      return quick || humans || Number(b.updatedAt) - Number(a.updatedAt);
    });
  return candidates[0] ?? null;
}

export function roomFilter(room, { mode = "all", status = "all" } = {}) {
  if (!room) return false;
  if (mode !== "all" && room.source !== mode) return false;
  if (status === "lobby" && room.status !== "lobby") return false;
  if (status === "playing" && room.status !== "playing") return false;
  if (status === "open" && (!room.public || !roomHasSpace(room))) return false;
  return true;
}

export function describeRoom(room) {
  if (!room) return "";
  const parts = [roomModeText(room), roomStatusText(room)];
  if (Number(room.bots) > 0) parts.push(`${room.bots} бот.`);
  return parts.join(" · ");
}
