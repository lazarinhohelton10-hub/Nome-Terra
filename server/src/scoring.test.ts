import { describe, expect, it } from 'vitest';
import { normalizeAnswer, scoreCategory } from './scoring.js';

describe('normalizeAnswer', () => {
  it('ignora maiúsculas, espaços e acentos ao comparar', () => {
    expect(normalizeAnswer('Macaco')).toBe(normalizeAnswer(' MACACO '));
    expect(normalizeAnswer('Águia')).toBe(normalizeAnswer('aguia'));
  });
});

describe('scoreCategory - classic (10/5/0)', () => {
  it('dá 10 pontos a uma resposta válida exclusiva', () => {
    const points = scoreCategory(
      [
        { sessionId: 'a', normalized: normalizeAnswer('Anta') },
        { sessionId: 'b', normalized: normalizeAnswer('macaco') },
      ],
      'classic'
    );
    expect(points.a).toBe(10);
    expect(points.b).toBe(10);
  });

  it('dá 5 pontos a cada jogador quando a resposta se repete', () => {
    const points = scoreCategory(
      [
        { sessionId: 'lazarinho', normalized: normalizeAnswer('Macaco') },
        { sessionId: 'joao', normalized: normalizeAnswer('macaco') },
        { sessionId: 'pedro', normalized: normalizeAnswer('Morcego') },
      ],
      'classic'
    );
    expect(points.lazarinho).toBe(5);
    expect(points.joao).toBe(5);
    expect(points.pedro).toBe(10);
  });

  it('respostas inválidas ou vazias nunca entram nesta lista, logo não pontuam', () => {
    // simula o caso da secção 23: uma resposta repetida é rejeitada pela
    // votação e não deve ser contada como duplicado das restantes.
    const points = scoreCategory(
      [
        { sessionId: 'joao', normalized: normalizeAnswer('Morcego') },
        { sessionId: 'pedro', normalized: normalizeAnswer('Morcego') },
        // a resposta do Lazarinho foi rejeitada e por isso nunca chega aqui
      ],
      'classic'
    );
    expect(points.joao).toBe(5);
    expect(points.pedro).toBe(5);
    expect(Object.keys(points)).toHaveLength(2);
  });
});

describe('scoreCategory - differentiated (20/10/0)', () => {
  it('usa 20/10 em vez de 10/5', () => {
    const points = scoreCategory(
      [
        { sessionId: 'a', normalized: normalizeAnswer('Anta') },
        { sessionId: 'b', normalized: normalizeAnswer('Anta') },
        { sessionId: 'c', normalized: normalizeAnswer('Aguia') },
      ],
      'differentiated'
    );
    expect(points.a).toBe(10);
    expect(points.b).toBe(10);
    expect(points.c).toBe(20);
  });
});

describe('scoreCategory - no_duplicates', () => {
  it('penaliza duplicados a zero pontos', () => {
    const points = scoreCategory(
      [
        { sessionId: 'a', normalized: normalizeAnswer('Anta') },
        { sessionId: 'b', normalized: normalizeAnswer('Anta') },
        { sessionId: 'c', normalized: normalizeAnswer('Aguia') },
      ],
      'no_duplicates'
    );
    expect(points.a).toBe(0);
    expect(points.b).toBe(0);
    expect(points.c).toBe(10);
  });
});
