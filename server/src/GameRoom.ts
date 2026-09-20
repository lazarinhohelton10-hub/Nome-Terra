import { nanoid } from 'nanoid';
import type {
  AnswerSet,
  CategoryResult,
  CategoryResultPublic,
  GameState,
  Player,
  PublicPlayer,
  PublicRoomState,
  RoomSettings,
  RoundRecord,
  VoteValue,
} from './types.js';
import { DEFAULT_LETTERS, pickRandomLetter } from './letters.js';
import { normalizeAnswer, scoreCategory } from './scoring.js';

const DEFAULT_CATEGORIES = ['Nome', 'Terra', 'Animal', 'Comida', 'Objeto'];

export const DEFAULT_SETTINGS: RoomSettings = {
  totalRounds: 5,
  roundSeconds: 60,
  categories: [...DEFAULT_CATEGORIES],
  enabledLetters: [...DEFAULT_LETTERS],
  maxPlayers: 12,
  scoringMode: 'classic',
  autoAdvanceSeconds: null,
};

type Emit = (event: string, payload: unknown) => void;

/**
 * Uma sala de jogo completa. O GameRoom é a única fonte de verdade: o
 * servidor nunca aceita letra, timer, estado ou pontuação vindos do
 * cliente — só nomes, respostas e votos.
 */
export class GameRoom {
  readonly code: string;
  hostSessionId: string;
  state: GameState = 'LOBBY';
  settings: RoomSettings = { ...DEFAULT_SETTINGS };
  players = new Map<string, Player>(); // sessionId -> Player
  usedLetters: string[] = [];
  currentRound = 0;
  currentLetter: string | null = null;
  currentAnswers = new Map<string, AnswerSet>(); // sessionId -> respostas da ronda atual
  history: RoundRecord[] = [];
  roundTimer: ReturnType<typeof setTimeout> | null = null;
  roundEndsAt: number | null = null;
  lastActivityAt = Date.now();
  private stoppedBySessionId: string | null = null;
  private pendingResults: CategoryResult[] | null = null;

  constructor(code: string, hostSessionId: string) {
    this.code = code;
    this.hostSessionId = hostSessionId;
  }

  touch() {
    this.lastActivityAt = Date.now();
  }

  // ---------- Jogadores ----------

  addPlayer(sessionId: string, socketId: string, name: string): Player {
    const existing = this.players.get(sessionId);
    if (existing) {
      existing.id = socketId;
      existing.connected = true;
      existing.disconnectedAt = null;
      return existing;
    }
    const player: Player = {
      id: socketId,
      sessionId,
      name,
      isHost: this.players.size === 0,
      connected: true,
      disconnectedAt: null,
      totalScore: 0,
      roundsWon: 0,
      validAnswers: 0,
      uniqueAnswers: 0,
    };
    if (player.isHost) this.hostSessionId = sessionId;
    this.players.set(sessionId, player);
    return player;
  }

  markDisconnected(sessionId: string) {
    const p = this.players.get(sessionId);
    if (!p) return;
    p.connected = false;
    p.disconnectedAt = Date.now();
  }

  removePlayer(sessionId: string) {
    this.players.delete(sessionId);
    if (this.hostSessionId === sessionId) {
      const next = [...this.players.values()].find((p) => p.connected) ?? [...this.players.values()][0];
      if (next) {
        next.isHost = true;
        this.hostSessionId = next.sessionId;
      }
    }
  }

  get connectedCount(): number {
    return [...this.players.values()].filter((p) => p.connected).length;
  }

  isEmpty(): boolean {
    return this.connectedCount === 0;
  }

  // ---------- Configuração (apenas host, apenas em LOBBY) ----------

  updateSettings(partial: Partial<RoomSettings>) {
    if (this.state !== 'LOBBY') return;
    this.settings = { ...this.settings, ...partial };
    // nunca deixar a sala sem categorias/letras válidas
    if (this.settings.categories.length === 0) this.settings.categories = [...DEFAULT_CATEGORIES];
    if (this.settings.enabledLetters.length === 0) this.settings.enabledLetters = [...DEFAULT_LETTERS];
  }

  // ---------- Ciclo de jogo ----------

  startGame() {
    if (this.state !== 'LOBBY') return;
    this.usedLetters = [];
    this.history = [];
    this.currentRound = 0;
    for (const p of this.players.values()) {
      p.totalScore = 0;
      p.roundsWon = 0;
      p.validAnswers = 0;
      p.uniqueAnswers = 0;
    }
    this.state = 'COUNTDOWN';
  }

  /** Chamado depois da animação de countdown no cliente (ou por timeout do servidor). */
  startRound(emit: Emit) {
    this.currentRound += 1;
    const letter = pickRandomLetter(this.settings.enabledLetters, this.usedLetters);
    if (!letter) {
      // esgotaram-se as letras disponíveis: termina a partida de forma controlada
      this.finishGame();
      emit('game:finished', this.toPublicState(null));
      return;
    }
    this.currentLetter = letter;
    this.usedLetters.push(letter);
    this.currentAnswers = new Map();
    this.stoppedBySessionId = null;
    this.pendingResults = null;
    this.state = 'PLAYING';
    this.roundEndsAt = Date.now() + this.settings.roundSeconds * 1000;

    this.clearRoundTimer();
    this.roundTimer = setTimeout(() => {
      this.forceStopRound('timeout');
      emit('game:round_finished', { reason: 'timeout', state: this.toPublicState(null) });
    }, this.settings.roundSeconds * 1000);
  }

  submitAnswer(sessionId: string, category: string, value: string) {
    if (this.state !== 'PLAYING') return;
    if (!this.settings.categories.includes(category)) return;
    const set = this.currentAnswers.get(sessionId) ?? {};
    set[category] = value.slice(0, 60); // limite defensivo
    this.currentAnswers.set(sessionId, set);
    this.touch();
  }

  /** Qualquer jogador ligado pode carregar STOP (ver regras da sala). */
  stopRound(sessionId: string): boolean {
    if (this.state !== 'PLAYING') return false;
    this.stoppedBySessionId = sessionId;
    this.forceStopRound('stop');
    return true;
  }

  private forceStopRound(_reason: 'stop' | 'timeout') {
    if (this.state !== 'PLAYING') return;
    this.clearRoundTimer();
    this.state = 'REVIEW';
    this.pendingResults = this.buildReviewSkeleton();
  }

  private clearRoundTimer() {
    if (this.roundTimer) {
      clearTimeout(this.roundTimer);
      this.roundTimer = null;
    }
  }

  private buildReviewSkeleton(): CategoryResult[] {
    const letter = this.currentLetter!;
    const normalizedLetter = normalizeAnswer(letter);
    const results: CategoryResult[] = [];
    for (const category of this.settings.categories) {
      const entries: CategoryResult['entries'] = {};
      for (const [sessionId, answers] of this.currentAnswers.entries()) {
        const answer = (answers[category] ?? '').trim();
        if (!answer) continue; // resposta vazia: nem entra na revisão, vale 0 automaticamente
        const normalized = normalizeAnswer(answer);
        const systemRecognized = normalized.startsWith(normalizedLetter);
        entries[sessionId] = {
          answer,
          normalized,
          systemRecognized,
          votes: {},
          valid: false,
          points: 0,
        };
      }
      results.push({ category, entries });
    }
    return results;
  }

  /** Um jogador vota na resposta de outro jogador (nunca na própria). */
  castVote(voterSessionId: string, category: string, targetSessionId: string, vote: VoteValue) {
    if (this.state !== 'REVIEW' || !this.pendingResults) return;
    if (voterSessionId === targetSessionId) return; // nunca votar em si próprio
    const cat = this.pendingResults.find((c) => c.category === category);
    const entry = cat?.entries[targetSessionId];
    if (!cat || !entry) return;
    entry.votes[voterSessionId] = vote;
    this.touch();
  }

  /** Decisão do host em caso de empate na votação. */
  hostDecide(category: string, targetSessionId: string, decision: VoteValue) {
    if (this.state !== 'REVIEW' || !this.pendingResults) return;
    const cat = this.pendingResults.find((c) => c.category === category);
    const entry = cat?.entries[targetSessionId];
    if (!entry) return;
    entry.hostDecision = decision;
  }

  /** Todos os jogadores elegíveis já votaram em todas as respostas que precisam de voto? */
  everyoneVoted(): boolean {
    if (!this.pendingResults) return false;
    const eligibleVoters = [...this.players.keys()];
    for (const cat of this.pendingResults) {
      for (const [targetId, entry] of Object.entries(cat.entries)) {
        const voters = eligibleVoters.filter((v) => v !== targetId);
        for (const voterId of voters) {
          if (!(voterId in entry.votes)) return false;
        }
      }
    }
    return true;
  }

  /** Calcula validade final (maioria; empate fica 'disputed' até o host decidir) e pontua. */
  finalizeReview(): { roundDelta: Record<string, number>; ranking: PublicPlayer[] } {
    if (!this.pendingResults) return { roundDelta: {}, ranking: this.publicPlayers() };

    for (const cat of this.pendingResults) {
      const validForScoring: { sessionId: string; normalized: string }[] = [];
      for (const [sessionId, entry] of Object.entries(cat.entries)) {
        const votes = Object.values(entry.votes);
        const accepts = votes.filter((v) => v === 'accept').length;
        const rejects = votes.filter((v) => v === 'reject').length;
        if (entry.hostDecision) {
          entry.valid = entry.hostDecision === 'accept';
        } else if (votes.length === 0) {
          // ninguém tinha de votar (ex.: sala com 1 jogador ligado): aceita a indicação do sistema
          entry.valid = entry.systemRecognized;
        } else if (accepts > rejects) {
          entry.valid = true;
        } else if (rejects > accepts) {
          entry.valid = false;
        } else {
          entry.valid = 'disputed';
        }
        if (entry.valid === true) validForScoring.push({ sessionId, normalized: entry.normalized });
      }
      const points = scoreCategory(validForScoring, this.settings.scoringMode);
      for (const [sessionId, entry] of Object.entries(cat.entries)) {
        entry.points = points[sessionId] ?? 0;
      }
    }

    const roundDelta: Record<string, number> = {};
    for (const sessionId of this.players.keys()) roundDelta[sessionId] = 0;
    for (const cat of this.pendingResults) {
      for (const [sessionId, entry] of Object.entries(cat.entries)) {
        roundDelta[sessionId] = (roundDelta[sessionId] ?? 0) + entry.points;
        const player = this.players.get(sessionId);
        if (player && entry.valid === true) {
          player.validAnswers += 1;
          const counts = Object.values(cat.entries).filter(
            (e) => e.valid === true && e.normalized === entry.normalized
          ).length;
          if (counts === 1) player.uniqueAnswers += 1;
        }
      }
    }

    for (const [sessionId, delta] of Object.entries(roundDelta)) {
      const player = this.players.get(sessionId);
      if (player) player.totalScore += delta;
    }

    const topScore = Math.max(...Object.values(roundDelta), 0);
    if (topScore > 0) {
      const winners = Object.entries(roundDelta).filter(([, d]) => d === topScore);
      for (const [sessionId] of winners) {
        const player = this.players.get(sessionId);
        if (player) player.roundsWon += 1;
      }
    }

    this.history.push({
      roundNumber: this.currentRound,
      letter: this.currentLetter!,
      answers: Object.fromEntries(this.currentAnswers),
      results: this.pendingResults,
      scoreDelta: roundDelta,
      stoppedBy: this.stoppedBySessionId,
    });

    this.state = 'SCORING';
    return { roundDelta, ranking: this.publicPlayers() };
  }

  hasNextRound(): boolean {
    return this.currentRound < this.settings.totalRounds && this.usedLetters.length < this.settings.enabledLetters.length;
  }

  advanceToNextRoundOrFinish(emit: Emit) {
    if (this.hasNextRound()) {
      this.state = 'COUNTDOWN';
    } else {
      this.finishGame();
      emit('game:finished', this.toPublicState(null));
    }
  }

  finishGame() {
    this.clearRoundTimer();
    this.state = 'FINISHED';
    this.currentLetter = null;
    this.roundEndsAt = null;
  }

  resetForRematch() {
    this.state = 'LOBBY';
    this.currentRound = 0;
    this.currentLetter = null;
    this.usedLetters = [];
    this.history = [];
    this.currentAnswers = new Map();
    this.pendingResults = null;
    this.roundEndsAt = null;
    for (const p of this.players.values()) {
      p.totalScore = 0;
      p.roundsWon = 0;
      p.validAnswers = 0;
      p.uniqueAnswers = 0;
    }
  }

  // ---------- Serialização para o cliente ----------

  publicPlayers(): PublicPlayer[] {
    return [...this.players.values()]
      .map((p) => ({
        sessionId: p.sessionId,
        name: p.name,
        isHost: p.isHost,
        connected: p.connected,
        totalScore: p.totalScore,
        roundsWon: p.roundsWon,
        validAnswers: p.validAnswers,
        uniqueAnswers: p.uniqueAnswers,
      }))
      .sort((a, b) => b.totalScore - a.totalScore);
  }

  private reviewPublic(): PublicRoomState['review'] {
    if (!this.pendingResults) return null;
    const categories: CategoryResultPublic[] = this.pendingResults.map((cat) => ({
      category: cat.category,
      entries: Object.entries(cat.entries).map(([sessionId, e]) => {
        const votes = Object.values(e.votes);
        return {
          sessionId,
          playerName: this.players.get(sessionId)?.name ?? '???',
          answer: e.answer,
          systemRecognized: e.systemRecognized,
          valid: e.valid,
          points: e.points,
          acceptCount: votes.filter((v) => v === 'accept').length,
          rejectCount: votes.filter((v) => v === 'reject').length,
          totalVoters: this.players.size - 1,
        };
      }),
    }));
    return { categories, votesNeededFrom: [] };
  }

  toPublicState(forSessionId: string | null): PublicRoomState {
    return {
      code: this.code,
      state: this.state,
      settings: this.settings,
      players: this.publicPlayers(),
      currentRound: this.currentRound,
      totalRounds: this.settings.totalRounds,
      currentLetter: this.currentLetter,
      usedLetters: this.usedLetters,
      roundEndsAt: this.roundEndsAt,
      roundDurationMs: this.settings.roundSeconds * 1000,
      myAnswers: forSessionId ? this.currentAnswers.get(forSessionId) ?? {} : null,
      review: this.state === 'REVIEW' || this.state === 'SCORING' ? this.reviewPublic() : null,
      scoring:
        this.state === 'SCORING' && this.history.length > 0
          ? {
              roundDelta: this.history[this.history.length - 1].scoreDelta,
              ranking: this.publicPlayers(),
            }
          : null,
      finished: this.state === 'FINISHED' ? { ranking: this.publicPlayers() } : null,
    };
  }
}

export function generateRoomCode(): string {
  // 5 caracteres, sem 0/O/1/I para reduzir erros ao ditar o código
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

export function generateSessionId(): string {
  return nanoid(21);
}
