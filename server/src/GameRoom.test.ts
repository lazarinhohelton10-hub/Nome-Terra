import { describe, expect, it, vi } from 'vitest';
import { GameRoom } from './GameRoom.js';
import { pickRandomLetter } from './letters.js';

function makeRoom() {
  const room = new GameRoom('ABCDE', 'host-session');
  room.addPlayer('host-session', 'socket-1', 'Lazarinho');
  room.addPlayer('p2', 'socket-2', 'João');
  room.updateSettings({ totalRounds: 2, roundSeconds: 60 });
  return room;
}

describe('pickRandomLetter', () => {
  it('nunca repete uma letra já usada', () => {
    const used = ['A', 'B', 'C'];
    for (let i = 0; i < 50; i++) {
      const letter = pickRandomLetter(['A', 'B', 'C', 'D'], used);
      expect(letter).toBe('D');
    }
  });

  it('devolve null quando todas as letras já foram usadas', () => {
    expect(pickRandomLetter(['A', 'B'], ['A', 'B'])).toBeNull();
  });
});

describe('GameRoom - ciclo de uma ronda', () => {
  it('avança LOBBY -> COUNTDOWN -> PLAYING -> REVIEW -> SCORING', () => {
    const room = makeRoom();
    const emit = vi.fn();

    room.startGame();
    expect(room.state).toBe('COUNTDOWN');

    room.startRound(emit);
    expect(room.state).toBe('PLAYING');
    expect(room.currentLetter).not.toBeNull();
    expect(room.usedLetters).toHaveLength(1);

    room.submitAnswer('host-session', 'Animal', 'Macaco');
    room.submitAnswer('p2', 'Animal', 'Macaco');

    const stopped = room.stopRound('host-session');
    expect(stopped).toBe(true);
    expect(room.state).toBe('REVIEW');

    // ninguém pode votar em si próprio
    room.castVote('host-session', 'Animal', 'host-session', 'accept');
    room.castVote('p2', 'Animal', 'host-session', 'accept');
    room.castVote('host-session', 'Animal', 'p2', 'accept');

    const { roundDelta } = room.finalizeReview();
    expect(room.state).toBe('SCORING');
    // resposta repetida e válida -> 5 pontos cada (modo clássico)
    expect(roundDelta['host-session']).toBe(5);
    expect(roundDelta['p2']).toBe(5);
  });

  it('não deixa um jogador validar a própria resposta', () => {
    const room = makeRoom();
    const emit = vi.fn();
    room.startGame();
    room.startRound(emit);
    room.submitAnswer('host-session', 'Animal', 'Macaco');
    room.stopRound('host-session');

    room.castVote('host-session', 'Animal', 'host-session', 'accept');
    const cat = room.toPublicState('host-session').review!.categories[0];
    const entry = cat.entries.find((e) => e.sessionId === 'host-session');
    expect(entry?.acceptCount ?? 0).toBe(0);
  });
});
