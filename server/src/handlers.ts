import type { Server, Socket } from 'socket.io';
import { RoomManager } from './RoomManager.js';
import { GameRoom, generateSessionId } from './GameRoom.js';
import type { RoomSettings, VoteValue } from './types.js';

const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS ?? 45_000);
const COUNTDOWN_MS = 3_000;

interface SocketData {
  sessionId: string;
  roomCode: string;
}

function sanitizeName(raw: unknown): string {
  const name = String(raw ?? '').trim();
  // remove tags HTML/scripts, mantém letras (incluindo acentuadas), números, espaços e alguns símbolos
  const stripped = name.replace(/<[^>]*>/g, '');
  return stripped.slice(0, 16);
}

function friendlyError(message: string) {
  return { ok: false as const, error: message };
}

export function registerHandlers(io: Server, rooms: RoomManager) {
  const disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>(); // key: `${code}:${sessionId}`

  function broadcastRoomState(room: GameRoom) {
    const sockets = io.sockets.adapter.rooms.get(room.code);
    if (!sockets) return;
    for (const socketId of sockets) {
      const s = io.sockets.sockets.get(socketId);
      const sessionId = (s?.data as SocketData | undefined)?.sessionId ?? null;
      s?.emit('room:state', room.toPublicState(sessionId));
    }
  }

  function scheduleCountdownThenChoosing(room: GameRoom) {
    setTimeout(() => {
      if (room.state !== 'COUNTDOWN') return; // pode ter sido cancelado (sala esvaziou, etc.)
      const result = room.enterChoosingLetter((event, payload) => {
        io.to(room.code).emit(event, payload);
        // Cobre o caso raro de as letras/rondas se esgotarem exatamente aqui
        // (ver GameRoom.enterChoosingLetter) — sem isto ninguém veria o
        // ecrã de resultado final.
        broadcastRoomState(room);
      });
      broadcastRoomState(room);
      if (result?.substituted) {
        io.to(room.code).emit('game:controller_reassigned', { name: result.controllerName });
      }
    }, COUNTDOWN_MS);
  }

  function finalizeIfReady(room: GameRoom) {
    if (room.state === 'REVIEW' && room.everyoneVoted()) {
      const result = room.finalizeReview();
      io.to(room.code).emit('game:round_finished', { reason: 'validated' });
      broadcastRoomState(room);
      if (room.settings.autoAdvanceSeconds) {
        setTimeout(() => {
          if (room.state !== 'SCORING') return;
          advanceRound(room);
        }, room.settings.autoAdvanceSeconds * 1000);
      }
      return result;
    }
    return null;
  }

  function advanceRound(room: GameRoom) {
    room.advanceToNextRoundOrFinish((event, payload) => io.to(room.code).emit(event, payload));
    broadcastRoomState(room);
    if (room.state === 'COUNTDOWN') scheduleCountdownThenChoosing(room);
  }

  io.on('connection', (socket: Socket) => {
    socket.on(
      'room:create',
      (payload: { name: string }, ack: (res: unknown) => void) => {
        const name = sanitizeName(payload?.name);
        if (!name) return ack(friendlyError('Escolhe um nome antes de criar a sala.'));

        const sessionId = generateSessionId();
        const room = rooms.create(sessionId);
        room.addPlayer(sessionId, socket.id, name);

        socket.data = { sessionId, roomCode: room.code } as SocketData;
        socket.join(room.code);
        ack({ ok: true, code: room.code, sessionId });
        broadcastRoomState(room);
      }
    );

    socket.on(
      'room:join',
      (payload: { code: string; name: string }, ack: (res: unknown) => void) => {
        const code = String(payload?.code ?? '').trim().toUpperCase();
        const name = sanitizeName(payload?.name);
        const room = rooms.get(code);

        if (!room) return ack(friendlyError('Não foi possível entrar na sala. Verifica o código.'));
        if (!name) return ack(friendlyError('Escolhe um nome antes de entrar na sala.'));
        if (room.state !== 'LOBBY') return ack(friendlyError('A partida já começou.'));
        if (room.connectedCount >= room.settings.maxPlayers) {
          return ack(friendlyError('Esta sala atingiu o limite de jogadores.'));
        }
        const nameTaken = [...room.players.values()].some(
          (p) => p.connected && p.name.toLowerCase() === name.toLowerCase()
        );
        if (nameTaken) return ack(friendlyError('O teu nome já está a ser utilizado nesta sala.'));

        const sessionId = generateSessionId();
        room.addPlayer(sessionId, socket.id, name);
        socket.data = { sessionId, roomCode: room.code } as SocketData;
        socket.join(room.code);

        ack({ ok: true, code: room.code, sessionId });
        io.to(room.code).emit('room:player_joined', { name });
        broadcastRoomState(room);
      }
    );

    socket.on(
      'room:rejoin',
      (payload: { code: string; sessionId: string }, ack: (res: unknown) => void) => {
        const code = String(payload?.code ?? '').trim().toUpperCase();
        const room = rooms.get(code);
        if (!room) return ack(friendlyError('A sala já não existe.'));
        const existing = room.players.get(payload?.sessionId);
        if (!existing) return ack(friendlyError('Não foi possível reconectar a esta sessão.'));

        const timerKey = `${code}:${existing.sessionId}`;
        const pendingTimer = disconnectTimers.get(timerKey);
        if (pendingTimer) {
          clearTimeout(pendingTimer);
          disconnectTimers.delete(timerKey);
        }

        room.addPlayer(existing.sessionId, socket.id, existing.name);
        socket.data = { sessionId: existing.sessionId, roomCode: room.code } as SocketData;
        socket.join(room.code);

        ack({ ok: true, code: room.code, sessionId: existing.sessionId });
        io.to(room.code).emit('room:player_reconnected', { name: existing.name });
        broadcastRoomState(room);
      }
    );

    socket.on('room:update_settings', (partial: Partial<RoomSettings>) => {
      const data = socket.data as SocketData | undefined;
      const room = data && rooms.get(data.roomCode);
      if (!room || room.hostSessionId !== data?.sessionId) return;
      room.updateSettings(partial);
      broadcastRoomState(room);
    });

    socket.on('room:kick', (payload: { targetSessionId: string }) => {
      const data = socket.data as SocketData | undefined;
      const room = data && rooms.get(data.roomCode);
      if (!room || room.hostSessionId !== data?.sessionId) return;
      const target = room.players.get(payload.targetSessionId);
      if (!target) return;
      const targetSocket = io.sockets.sockets.get(target.id);
      room.removePlayer(payload.targetSessionId);
      targetSocket?.emit('room:kicked', {});
      targetSocket?.leave(room.code);
      io.to(room.code).emit('room:player_left', { name: target.name });
      const reassignment = room.reassignControllerIfNeeded();
      if (reassignment.changed) {
        io.to(room.code).emit('game:controller_reassigned', { name: reassignment.newControllerName });
      }
      broadcastRoomState(room);
    });

    socket.on('room:leave', () => {
      handleLeave(socket, { permanent: true });
    });

    socket.on('game:start', () => {
      const data = socket.data as SocketData | undefined;
      const room = data && rooms.get(data.roomCode);
      if (!room || room.hostSessionId !== data?.sessionId) return;
      if (room.connectedCount < 2) return; // regra: mínimo 2 jogadores
      room.startGame();
      broadcastRoomState(room);
      scheduleCountdownThenChoosing(room);
    });

    socket.on('game:choose_letter', (payload: { letter: string }) => {
      const data = socket.data as SocketData | undefined;
      const room = data && rooms.get(data.roomCode);
      if (!room || !data) return;
      const chosen = room.chooseLetter(data.sessionId, payload?.letter ?? '', (event, eventPayload) => {
        io.to(room.code).emit(event, eventPayload);
        broadcastRoomState(room);
      });
      if (chosen) broadcastRoomState(room);
    });

    socket.on('game:submit_answer', (payload: { category: string; value: string }) => {
      const data = socket.data as SocketData | undefined;
      const room = data && rooms.get(data.roomCode);
      if (!room || !data) return;
      room.submitAnswer(data.sessionId, payload.category, payload.value ?? '');
      // Não faz broadcast completo a cada tecla premida (evita tempestade de eventos);
      // as respostas só se tornam visíveis a todos na fase de revisão.
    });

    socket.on('game:stop', () => {
      const data = socket.data as SocketData | undefined;
      const room = data && rooms.get(data.roomCode);
      if (!room || !data) return;
      const stopped = room.stopRound(data.sessionId);
      if (stopped) {
        const player = room.players.get(data.sessionId);
        io.to(room.code).emit('game:round_finished', { reason: 'stop', by: player?.name ?? '???' });
        broadcastRoomState(room);
      }
    });

    socket.on(
      'game:vote',
      (payload: { category: string; targetSessionId: string; vote: VoteValue }) => {
        const data = socket.data as SocketData | undefined;
        const room = data && rooms.get(data.roomCode);
        if (!room || !data) return;
        room.castVote(data.sessionId, payload.category, payload.targetSessionId, payload.vote);
        broadcastRoomState(room);
        finalizeIfReady(room);
      }
    );

    socket.on(
      'game:host_decide',
      (payload: { category: string; targetSessionId: string; decision: VoteValue }) => {
        const data = socket.data as SocketData | undefined;
        const room = data && rooms.get(data.roomCode);
        if (!room || room.hostSessionId !== data?.sessionId) return;
        room.hostDecide(payload.category, payload.targetSessionId, payload.decision);
        broadcastRoomState(room);
        finalizeIfReady(room);
      }
    );

    socket.on('game:force_finalize', () => {
      // permite ao anfitrião avançar mesmo que nem todos tenham votado
      // (ex.: alguém desligou-se durante a revisão)
      const data = socket.data as SocketData | undefined;
      const room = data && rooms.get(data.roomCode);
      if (!room || room.hostSessionId !== data?.sessionId || room.state !== 'REVIEW') return;
      room.finalizeReview();
      io.to(room.code).emit('game:round_finished', { reason: 'validated' });
      broadcastRoomState(room);
    });

    socket.on('game:next_round', () => {
      const data = socket.data as SocketData | undefined;
      const room = data && rooms.get(data.roomCode);
      if (!room || room.hostSessionId !== data?.sessionId || room.state !== 'SCORING') return;
      advanceRound(room);
    });

    socket.on('game:rematch', () => {
      const data = socket.data as SocketData | undefined;
      const room = data && rooms.get(data.roomCode);
      if (!room || room.hostSessionId !== data?.sessionId || room.state !== 'FINISHED') return;
      room.resetForRematch();
      broadcastRoomState(room);
    });

    socket.on('disconnect', () => {
      handleLeave(socket, { permanent: false });
    });

    function handleLeave(s: Socket, opts: { permanent: boolean }) {
      const data = s.data as SocketData | undefined;
      if (!data) return;
      const room = rooms.get(data.roomCode);
      if (!room) return;
      const player = room.players.get(data.sessionId);
      if (!player) return;

      if (opts.permanent) {
        room.removePlayer(data.sessionId);
        io.to(room.code).emit('room:player_left', { name: player.name });
        const reassignment = room.reassignControllerIfNeeded();
        if (reassignment.changed) {
          io.to(room.code).emit('game:controller_reassigned', { name: reassignment.newControllerName });
        }
        broadcastRoomState(room);
        if (room.isEmpty()) rooms.delete(room.code);
        return;
      }

      room.markDisconnected(data.sessionId);
      io.to(room.code).emit('room:player_disconnected', { name: player.name });
      broadcastRoomState(room);

      const timerKey = `${room.code}:${data.sessionId}`;
      const timer = setTimeout(() => {
        // se ainda não voltou dentro do período de tolerância, remove definitivamente
        // e, se era o responsável pela ronda, transfere o controlo (ver secção 28)
        const stillThere = room.players.get(data.sessionId);
        if (stillThere && !stillThere.connected) {
          room.removePlayer(data.sessionId);
          io.to(room.code).emit('room:player_left', { name: stillThere.name });
          const reassignment = room.reassignControllerIfNeeded();
          if (reassignment.changed) {
            io.to(room.code).emit('game:controller_reassigned', { name: reassignment.newControllerName });
          }
          broadcastRoomState(room);
          if (room.isEmpty()) rooms.delete(room.code);
        }
        disconnectTimers.delete(timerKey);
      }, RECONNECT_GRACE_MS);
      disconnectTimers.set(timerKey, timer);
    }
  });
}
