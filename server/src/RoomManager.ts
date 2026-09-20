import { GameRoom, generateRoomCode } from './GameRoom.js';

/**
 * Guarda todas as salas ativas em memória do processo Node.
 *
 * LIMITAÇÃO CONHECIDA (ver README): isto significa que reiniciar o servidor
 * apaga todas as salas, e que não é possível correr múltiplas instâncias do
 * servidor atrás de um load balancer sem partilhar este estado (ex.: via
 * Redis). Para o MVP local / uma única instância isto é suficiente e
 * corresponde ao que a secção 43 do briefing pede para a primeira versão.
 */
export class RoomManager {
  private rooms = new Map<string, GameRoom>();
  private ttlMs: number;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
    setInterval(() => this.sweep(), 60_000).unref();
  }

  create(hostSessionId: string): GameRoom {
    let code = generateRoomCode();
    while (this.rooms.has(code)) code = generateRoomCode();
    const room = new GameRoom(code, hostSessionId);
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): GameRoom | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  delete(code: string) {
    this.rooms.delete(code);
  }

  private sweep() {
    const now = Date.now();
    for (const [code, room] of this.rooms.entries()) {
      const idleMs = now - room.lastActivityAt;
      if (room.isEmpty() && idleMs > this.ttlMs) {
        this.rooms.delete(code);
      }
    }
  }
}
