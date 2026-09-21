import { describe, expect, it, vi } from 'vitest';
import { GameRoom } from './GameRoom.js';
import { pickRandomLetter, shuffle } from './letters.js';

function makeRoom() {
  const room = new GameRoom('ABCDE', 'host-session');
  room.addPlayer('host-session', 'socket-1', 'Lazarinho');
  room.addPlayer('p2', 'socket-2', 'João');
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

describe('shuffle', () => {
  it('mantém todos os elementos, só muda a ordem', () => {
    const original = ['a', 'b', 'c', 'd', 'e'];
    const shuffled = shuffle(original);
    expect(shuffled.sort()).toEqual([...original].sort());
    expect(original).toEqual(['a', 'b', 'c', 'd', 'e']); // não altera o array original
  });
});

describe('GameRoom - número de rondas = número de jogadores', () => {
  it('define o total de rondas como o número de jogadores ligados ao iniciar', () => {
    const room = new GameRoom('ABCDE', 'a');
    room.addPlayer('a', 's1', 'Ana');
    room.addPlayer('b', 's2', 'Bruno');
    room.addPlayer('c', 's3', 'Carla');
    room.startGame();
    expect(room.settings.totalRounds).toBe(3);
    expect(room.playerOrder).toHaveLength(3);
    expect(room.playerOrder.sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('GameRoom - ciclo de uma ronda com escolha de letra por turnos', () => {
  it('avança LOBBY -> COUNTDOWN -> CHOOSING_LETTER -> PLAYING -> REVIEW -> SCORING', () => {
    const room = makeRoom();
    const emit = vi.fn();

    room.startGame();
    expect(room.state).toBe('COUNTDOWN');
    expect(room.settings.totalRounds).toBe(2); // 2 jogadores

    const info = room.enterChoosingLetter(emit);
    expect(room.state).toBe('CHOOSING_LETTER');
    expect(info?.substituted).toBe(false);
    const controllerId = room.controllerSessionId!;
    expect(['host-session', 'p2']).toContain(controllerId);

    // só o responsável pode escolher a letra
    const otherId = controllerId === 'host-session' ? 'p2' : 'host-session';
    expect(room.chooseLetter(otherId, 'M', emit)).toBe(false);
    expect(room.chooseLetter(controllerId, 'M', emit)).toBe(true);
    expect(room.state).toBe('PLAYING');
    expect(room.currentLetter).toBe('M');

    room.submitAnswer('host-session', 'Animal', 'Macaco');
    room.submitAnswer('p2', 'Animal', 'Macaco');

    // só o responsável pode carregar STOP
    expect(room.stopRound(otherId)).toBe(false);
    expect(room.state).toBe('PLAYING');
    expect(room.stopRound(controllerId)).toBe(true);
    expect(room.state).toBe('REVIEW');

    room.castVote('host-session', 'Animal', 'p2', 'accept');
    room.castVote('p2', 'Animal', 'host-session', 'accept');

    const { roundDelta } = room.finalizeReview();
    expect(room.state).toBe('SCORING');
    expect(roundDelta['host-session']).toBe(5);
    expect(roundDelta['p2']).toBe(5);
  });

  it('não deixa escolher uma letra desativada ou já usada', () => {
    const room = makeRoom();
    const emit = vi.fn();
    room.updateSettings({ enabledLetters: ['M', 'A'] });
    room.startGame();
    room.enterChoosingLetter(emit);
    const controllerId = room.controllerSessionId!;

    expect(room.chooseLetter(controllerId, 'Z', emit)).toBe(false); // não está ativada
    expect(room.chooseLetter(controllerId, 'M', emit)).toBe(true);
    expect(room.usedLetters).toEqual(['M']);
  });

  it('substitui o responsável se ele estiver desligado quando chega a sua vez', () => {
    const room = new GameRoom('ABCDE', 'a');
    room.addPlayer('a', 's1', 'Ana');
    room.addPlayer('b', 's2', 'Bruno');
    room.startGame();
    room.playerOrder = ['a', 'b']; // força a ordem para o teste ser determinístico
    room.markDisconnected('a');

    const emit = vi.fn();
    const info = room.enterChoosingLetter(emit);
    expect(info?.substituted).toBe(true);
    expect(room.controllerSessionId).toBe('b'); // Bruno assume por Ana estar desligada
  });

  it('reatribui o controlo se o responsável se desligar a meio da ronda', () => {
    const room = new GameRoom('ABCDE', 'a');
    room.addPlayer('a', 's1', 'Ana');
    room.addPlayer('b', 's2', 'Bruno');
    room.startGame();
    room.playerOrder = ['a', 'b'];

    const emit = vi.fn();
    room.enterChoosingLetter(emit);
    expect(room.controllerSessionId).toBe('a');

    room.markDisconnected('a');
    const result = room.reassignControllerIfNeeded();
    expect(result.changed).toBe(true);
    expect(result.newControllerName).toBe('Bruno');
    expect(room.controllerSessionId).toBe('b');
  });

  it('não deixa um jogador validar a própria resposta', () => {
    const room = makeRoom();
    const emit = vi.fn();
    room.startGame();
    room.enterChoosingLetter(emit);
    const controllerId = room.controllerSessionId!;
    room.chooseLetter(controllerId, 'M', emit);
    room.submitAnswer(controllerId, 'Animal', 'Macaco');
    room.stopRound(controllerId);

    room.castVote(controllerId, 'Animal', controllerId, 'accept');
    const cat = room.toPublicState(controllerId).review!.categories[0];
    const entry = cat.entries.find((e) => e.sessionId === controllerId);
    expect(entry?.acceptCount ?? 0).toBe(0);
  });
});
