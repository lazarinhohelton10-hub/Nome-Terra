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
