export type GameState = 'LOBBY' | 'COUNTDOWN' | 'CHOOSING_LETTER' | 'PLAYING' | 'REVIEW' | 'SCORING' | 'FINISHED';
export type ScoringMode = 'classic' | 'differentiated' | 'no_duplicates';
export type VoteValue = 'accept' | 'reject';

export interface RoomSettings {
  totalRounds: number;
  roundSeconds: number;
  categories: string[];
  enabledLetters: string[];
  maxPlayers: number;
  scoringMode: ScoringMode;
  autoAdvanceSeconds: number | null;
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

export interface CategoryEntryPublic {
  sessionId: string;
  playerName: string;
  answer: string;
  systemRecognized: boolean;
  valid: boolean | 'disputed';
  points: number;
  acceptCount: number;
  rejectCount: number;
  totalVoters: number;
}

export interface CategoryResultPublic {
  category: string;
  entries: CategoryEntryPublic[];
}

export type AnswerSet = Record<string, string>;

export interface PublicRoomState {
  code: string;
  state: GameState;
  settings: RoomSettings;
  players: PublicPlayer[];
  currentRound: number;
  totalRounds: number;
  currentLetter: string | null;
  usedLetters: string[];
  roundEndsAt: number | null;
  roundDurationMs: number | null;
  myAnswers: AnswerSet | null;
  playerOrder: { sessionId: string; name: string }[];
  controllerSessionId: string | null;
  controllerName: string | null;
  availableLetters: string[];
  review: {
    categories: CategoryResultPublic[];
    votesNeededFrom: string[];
  } | null;
  scoring: {
    roundDelta: Record<string, number>;
    ranking: PublicPlayer[];
  } | null;
  finished: {
    ranking: PublicPlayer[];
  } | null;
}
