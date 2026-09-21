// Script manual de fumo: liga dois clientes reais via WebSocket ao servidor
// já em execução e percorre uma partida completa (2 jogadores = 2 rondas,
// cada um escolhe a letra da sua ronda por turnos), para confirmar que o
// fluxo end-to-end funciona sobre a rede, não apenas a lógica isolada
// testada pelo Vitest.
//
// Uso: npx tsx scripts/e2e-smoke.ts   (com o servidor já a correr)
import { io } from 'socket.io-client';

const URL = process.env.SERVER_URL ?? 'http://localhost:4000';

function connect() {
  return io(URL, { transports: ['websocket'] });
}

function ack<T>(socket: ReturnType<typeof connect>, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => socket.emit(event, payload, (res: T) => resolve(res)));
}

function waitForState(socket: ReturnType<typeof connect>, predicate: (s: any) => boolean): Promise<any> {
  return new Promise((resolve) => {
    socket.on('room:state', (s: any) => {
      if (predicate(s)) resolve(s);
    });
  });
}

async function playOneRound(
  a: ReturnType<typeof connect>,
  b: ReturnType<typeof connect>,
  aSessionId: string,
  letter: string
) {
  const choosingState = await waitForState(a, (s) => s.state === 'CHOOSING_LETTER' && s.controllerSessionId);
  const controllerId = choosingState.controllerSessionId;
  const controllerSocket = controllerId === aSessionId ? a : b;
  const nonControllerSocket = controllerSocket === a ? b : a;
  console.log(`✔ Ronda ${choosingState.currentRound}: responsável é ${choosingState.controllerName}`);

  controllerSocket.emit('game:choose_letter', { letter });
  const playing = await waitForState(a, (s) => s.state === 'PLAYING' && s.currentLetter === letter);
  console.log('✔ Letra escolhida e ronda em curso:', playing.currentLetter);

  a.emit('game:submit_answer', { category: 'Animal', value: `${letter}acaco` });
  b.emit('game:submit_answer', { category: 'Animal', value: `${letter}acaco` });
  await new Promise((r) => setTimeout(r, 200));

  // confirma que quem NÃO é o responsável não consegue carregar STOP
  nonControllerSocket.emit('game:stop');
  await new Promise((r) => setTimeout(r, 300));

  controllerSocket.emit('game:stop');
  const review = await waitForState(a, (s) => s.state === 'REVIEW');
  console.log('✔ STOP aceite só do responsável; em revisão');

  const entries = review.review.categories[0].entries;
  const targetForA = entries.find((e: any) => e.sessionId !== aSessionId).sessionId;
  const targetForB = entries.find((e: any) => e.sessionId === aSessionId).sessionId;
  a.emit('game:vote', { category: 'Animal', targetSessionId: targetForA, vote: 'accept' });
  b.emit('game:vote', { category: 'Animal', targetSessionId: targetForB, vote: 'accept' });

  const scoring = await waitForState(a, (s) => s.state === 'SCORING');
  console.log('✔ Pontuação da ronda:', scoring.scoring.roundDelta);
  const bothFive = Object.values(scoring.scoring.roundDelta).every((v) => v === 5);
  if (!bothFive) throw new Error(`Pontuação inesperada: ${JSON.stringify(scoring.scoring.roundDelta)}`);
  console.log('✔ Pontuação correta (5 pontos cada, resposta repetida e válida)');
}

async function main() {
  const a = connect();
  const b = connect();

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
  console.log('✔ João entrou na sala (2 jogadores => 2 rondas, uma cada)');

  a.emit('room:update_settings', { categories: ['Animal'], roundSeconds: 30 });
  await new Promise((r) => setTimeout(r, 200));

  a.emit('game:start');
  console.log('✔ Jogo iniciado');

  await playOneRound(a, b, createRes.sessionId, 'M');
  a.emit('game:next_round');

  await playOneRound(a, b, createRes.sessionId, 'A');
  a.emit('game:next_round'); // agora era a última ronda -> termina o jogo

  const finished = await waitForState(a, (s) => s.state === 'FINISHED');
  console.log(
    '✔ Jogo terminado após 2 rondas. Ranking final:',
    finished.finished.ranking.map((p: any) => `${p.name}: ${p.totalScore}`)
  );

  a.disconnect();
  b.disconnect();
  console.log('\n✅ SMOKE TEST END-TO-END PASSOU (escolha de letra por turnos incluída)');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ SMOKE TEST FALHOU:', err);
  process.exit(1);
});
