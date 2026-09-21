// Tipos partilhados pela lógica do jogo no servidor.
// (O cliente mantém a sua própria cópia em client/src/types.ts porque os dois
// projetos não partilham um build step; mantém-nos em sincronia manualmente.)

export type GameState =
  | 'LOBBY'
  | 'COUNTDOWN'
  | 'CHOOSING_LETTER'
  | 'PLAYING'
  | 'REVIEW'
  | 'SCORING'
  | 'FINISHED';

export type ScoringMode = 'classic' | 'differentiated' | 'no_duplicates';

export interface RoomSettings {
  totalRounds: number; // 5 | 10 | 15 | 20 | custom
  roundSeconds: number; // 30..120
  categories: string[];
  enabledLetters: string[];
  maxPlayers: number;
  scoringMode: ScoringMode;
  autoAdvanceSeconds: number | null; // null = host avança manualmente
}

export interface Player {
  id: string; // socket.id atual (muda ao reconectar)
  sessionId: string; // identificador persistente (guardado no localStorage do cliente)
  name: string;
  isHost: boolean;
  connected: boolean;
  disconnectedAt: number | null;
  totalScore: number;
  roundsWon: number;
  validAnswers: number;
  uniqueAnswers: number;
}

// answers[categoria] = texto
export type AnswerSet = Record<string, string>;

export type VoteValue = 'accept' | 'reject';

export interface AnswerVotes {
  // votante sessionId -> voto
  [voterSessionId: string]: VoteValue;
}

export interface CategoryResult {
  category: string;
  // por jogador: resposta, se foi considerada válida, pontos atribuídos, se houve empate/decisão do host
  entries: Record<
    string,
    {
      answer: string;
      normalized: string;
      systemRecognized: boolean;
      votes: AnswerVotes;
      valid: boolean | 'disputed';
      hostDecision?: VoteValue;
      points: number;
    }
  >;
}

export interface RoundRecord {
  roundNumber: number;
  letter: string;
  answers: Record<string, AnswerSet>; // sessionId -> respostas
  results: CategoryResult[] | null;
  scoreDelta: Record<string, number>; // sessionId -> pontos ganhos nesta ronda
  stoppedBy: string | null; // sessionId de quem carregou STOP (ou null se foi timeout)
}

export interface PublicPlayer {
  sessionId: string;
  name: string;
  isHost: boolean;
  connected: boolean;
  totalScore: number;
  roundsWon: number;
  validAnswers: number;
  uniqueAnswers: number;
}

export interface PublicRoomState {
  code: string;
  state: GameState;
  settings: RoomSettings;
  players: PublicPlayer[];
  currentRound: number;
  totalRounds: number;
  currentLetter: string | null;
  usedLetters: string[];
  roundEndsAt: number | null; // epoch ms, para o cliente calcular o countdown de forma sincronizada
  roundDurationMs: number | null;
  myAnswers: AnswerSet | null;
  playerOrder: { sessionId: string; name: string }[];
  controllerSessionId: string | null;
  controllerName: string | null;
  availableLetters: string[];
  review: {
    categories: CategoryResultPublic[];
    votesNeededFrom: string[]; // sessionIds que ainda faltam votar (para o próprio ecrã)
  } | null;
  scoring: {
    roundDelta: Record<string, number>;
    ranking: PublicPlayer[];
  } | null;
  finished: {
    ranking: PublicPlayer[];
  } | null;
}

export interface CategoryResultPublic {
  category: string;
  entries: {
    sessionId: string;
    playerName: string;
    answer: string;
    systemRecognized: boolean;
    valid: boolean | 'disputed';
    points: number;
    acceptCount: number;
    rejectCount: number;
    totalVoters: number;
  }[];
}
