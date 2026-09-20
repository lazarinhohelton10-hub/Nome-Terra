import { io, Socket } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:4000';

export const socket: Socket = io(SERVER_URL, {
  autoConnect: false,
  transports: ['websocket', 'polling'],
});

// --- Persistência de sessão (para reconexão/refresh, ver secção 28/29 do briefing) ---

const STORAGE_KEY = 'nome-terra:session';

export interface StoredSession {
  code: string;
  sessionId: string;
  name: string;
}

export function saveSession(session: StoredSession) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

// --- Ack helper com Promise, para não espalhar callbacks por todo o lado ---

export function emitWithAck<TResponse = { ok: boolean; error?: string; [k: string]: unknown }>(
  event: string,
  payload: unknown
): Promise<TResponse> {
  return new Promise((resolve) => {
    socket.emit(event, payload, (res: TResponse) => resolve(res));
  });
}
