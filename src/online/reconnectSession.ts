import type { ReconnectSession } from "../../shared/online";

export const RECONNECT_STORAGE_KEY = "gostop.online.reconnect";

export function readReconnectSession(): ReconnectSession | null {
  try {
    const raw = sessionStorage.getItem(RECONNECT_STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === "object" && "roomCode" in value && "token" in value &&
      typeof value.roomCode === "string" && /^[A-Z0-9]{6}$/.test(value.roomCode) &&
      typeof value.token === "string" && /^[a-f0-9]{64}$/.test(value.token)) {
      if ("role" in value && value.role !== "spectator") { clearReconnectSession(); return null; }
      return { roomCode: value.roomCode, token: value.token, ...("role" in value ? { role: "spectator" as const } : {}) };
    }
  } catch { /* Missing or unavailable browser storage must not break offline play. */ }
  clearReconnectSession();
  return null;
}

export function saveReconnectSession(session: ReconnectSession): boolean {
  try {
    sessionStorage.setItem(RECONNECT_STORAGE_KEY, JSON.stringify(session));
    return true;
  } catch { return false; }
}

export function clearReconnectSession() {
  try { sessionStorage.removeItem(RECONNECT_STORAGE_KEY); } catch { /* Storage may be disabled. */ }
}
