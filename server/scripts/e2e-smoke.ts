// Script manual de fumo: liga dois clientes reais via WebSocket ao servidor
// já em execução e percorre uma ronda completa, para confirmar que o fluxo
// end-to-end (não apenas a lógica isolada testada pelo Vitest) funciona.
//
// Uso: node dist-scripts/e2e-smoke.js  (depois de `npm run build`)
// ou:  npx tsx scripts/e2e-smoke.ts    (em desenvolvimento)
import { io } from 'socket.io-client';

const URL = process.env.SERVER_URL ?? 'http://localhost:4000';

function connect(name: string) {
  return io(URL, { transports: ['websocket'] });
}

function ack<T>(socket: ReturnType<typeof connect>, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => socket.emit(event, payload, (res: T) => resolve(res)));
}

function waitFor<T>(socket: ReturnType<typeof connect>, event: string): Promise<T> {
  return new Promise((resolve) => socket.once(event, (payload: T) => resolve(payload)));
}

async function main() {
  const a = connect('Lazarinho');
  const b = connect('João');

  const createRes = await ack<{ ok: boolean; code: string; sessionId: string }>(a, 'room:create', {
    name: 'Lazarinho',
  });
  if (!createRes.ok) throw new Error('Falha ao criar sala');
  console.log('✔ Sala criada:', createRes.code);

  const joinRes = await ack<{ ok: boolean; code: string; sessionId: string }>(b, 'room:join', {
    code: createRes.code,
    name: 'João',
  });
  if (!joinRes.ok) throw new Error('Falha ao entrar na sala');
  console.log('✔ João entrou na sala');

  // reduz para 1 categoria e tempo curto só para acelerar o smoke test
  a.emit('room:update_settings', { categories: ['Animal'], roundSeconds: 30, totalRounds: 1 });
  await new Promise((r) => setTimeout(r, 200));

  a.emit('game:start');
  console.log('✔ Jogo iniciado, a aguardar countdown + ronda...');

  // espera até ambos verem PLAYING com uma letra
  const letter = await new Promise<string>((resolve) => {
    a.on('room:state', (s: any) => {
      if (s.state === 'PLAYING' && s.currentLetter) resolve(s.currentLetter);
    });
  });
  console.log('✔ Ronda em curso com a letra', letter);

  a.emit('game:submit_answer', { category: 'Animal', value: `${letter}acaco` });
  b.emit('game:submit_answer', { category: 'Animal', value: `${letter}acaco` }); // resposta igual -> deve dar 5+5
  await new Promise((r) => setTimeout(r, 200));

  a.emit('game:stop');
  console.log('✔ STOP carregado');

  const reviewState = await new Promise<any>((resolve) => {
    a.on('room:state', (s: any) => {
      if (s.state === 'REVIEW') resolve(s);
    });
  });
  const entries = reviewState.review.categories[0].entries;
  console.log('✔ Fase de revisão, respostas:', entries.map((e: any) => `${e.playerName}: ${e.answer}`));

  const targetForA = entries.find((e: any) => e.playerName === 'João').sessionId;
  const targetForB = entries.find((e: any) => e.playerName === 'Lazarinho').sessionId;
  a.emit('game:vote', { category: 'Animal', targetSessionId: targetForA, vote: 'accept' });
  b.emit('game:vote', { category: 'Animal', targetSessionId: targetForB, vote: 'accept' });

  const scoringState = await new Promise<any>((resolve) => {
    a.on('room:state', (s: any) => {
      if (s.state === 'SCORING') resolve(s);
    });
  });
  console.log('✔ Pontuação da ronda:', scoringState.scoring.roundDelta);

  const bothFive = Object.values(scoringState.scoring.roundDelta).every((v) => v === 5);
  if (!bothFive) throw new Error(`Pontuação inesperada: ${JSON.stringify(scoringState.scoring.roundDelta)}`);
  console.log('✔ Pontuação correta (5 pontos cada, resposta repetida e válida)');

  a.emit('game:next_round'); // host avança; como totalRounds=1, isto termina o jogo
  const finishedState = await new Promise<any>((resolve) => {
    a.on('room:state', (s: any) => {
      if (s.state === 'FINISHED') resolve(s);
    });
  });
  console.log(
    '✔ Jogo terminado. Ranking final:',
    finishedState.finished.ranking.map((p: any) => `${p.name}: ${p.totalScore}`)
  );

  a.disconnect();
  b.disconnect();
  console.log('\n✅ SMOKE TEST END-TO-END PASSOU');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ SMOKE TEST FALHOU:', err);
  process.exit(1);
});
