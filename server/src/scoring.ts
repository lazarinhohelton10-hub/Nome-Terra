import type { ScoringMode } from './types.js';

/** Normaliza uma resposta apenas para efeitos de comparação interna
 * (maiúsculas/minúsculas, espaços, acentos). O texto original escrito pelo
 * jogador nunca é alterado no que é mostrado. */
export function normalizeAnswer(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // remove diacríticos
}

interface ValidEntry {
  sessionId: string;
  normalized: string;
}

/**
 * Recebe apenas as entradas já consideradas VÁLIDAS de uma categoria
 * (depois da validação/votação) e devolve os pontos de cada uma.
 *
 * classic:         resposta única -> 10 | resposta repetida -> 5 cada
 * differentiated:  resposta única -> 20 | resposta repetida -> 10 cada
 * no_duplicates:   resposta única -> 10 | resposta repetida -> 0
 */
export function scoreCategory(
  validEntries: ValidEntry[],
  mode: ScoringMode
): Record<string, number> {
  const counts = new Map<string, number>();
  for (const e of validEntries) {
    counts.set(e.normalized, (counts.get(e.normalized) ?? 0) + 1);
  }

  const points: Record<string, number> = {};
  for (const e of validEntries) {
    const isUnique = counts.get(e.normalized) === 1;
    let pts = 0;
    if (mode === 'classic') pts = isUnique ? 10 : 5;
    else if (mode === 'differentiated') pts = isUnique ? 20 : 10;
    else if (mode === 'no_duplicates') pts = isUnique ? 10 : 0;
    points[e.sessionId] = pts;
  }
  return points;
}
