export const DEFAULT_LETTERS = 'ABCDEFGHIJLMNOPQRSTUV'.split('');
export const ALL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/** Escolhe aleatoriamente uma letra ainda não usada. O servidor é sempre
 * a autoridade: o cliente nunca decide (nem sequer sugere) a letra. */
export function pickRandomLetter(
  enabledLetters: string[],
  usedLetters: string[]
): string | null {
  const pool = enabledLetters.filter((l) => !usedLetters.includes(l));
  if (pool.length === 0) return null;
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx];
}

/** Fisher-Yates: baralha uma lista sem alterar o array original. Usado para
 * gerar a ordem dos jogadores no início da partida (ver secção 2 do
 * briefing: ordem aleatória, não a ordem de entrada no lobby). */
export function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
