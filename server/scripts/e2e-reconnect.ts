import { io } from 'socket.io-client';

const URL = process.env.SERVER_URL ?? 'http://localhost:4000';

function ack<T>(socket: ReturnType<typeof io>, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => socket.emit(event, payload, (res: T) => resolve(res)));
}

async function main() {
  const a = io(URL, { transports: ['websocket'] });
  const b = io(URL, { transports: ['websocket'] });

  const created = await ack<{ ok: boolean; code: string; sessionId: string }>(a, 'room:create', {
    name: 'Lazarinho',
  });
  const joined = await ack<{ ok: boolean; code: string; sessionId: string }>(b, 'room:join', {
    code: created.code,
    name: 'João',
  });
  console.log('✔ Sala criada e João entrou:', created.code);

  a.emit('room:update_settings', { categories: ['Animal'], roundSeconds: 60 });
  await new Promise((r) => setTimeout(r, 200));
  a.emit('game:start');

  const choosing = await new Promise<any>((resolve) => {
    a.on('room:state', (s: any) => {
      if (s.state === 'CHOOSING_LETTER' && s.controllerSessionId) resolve(s);
    });
  });
  const controllerSocket = choosing.controllerSessionId === created.sessionId ? a : b;
  controllerSocket.emit('game:choose_letter', { letter: 'M' });

  await new Promise<void>((resolve) => {
    a.on('room:state', (s: any) => {
      if (s.state === 'PLAYING') resolve();
    });
  });
  console.log('✔ Ronda a decorrer');

  // João submete uma resposta e depois "atualiza a página" (desliga e reconecta com o mesmo sessionId)
  b.emit('game:submit_answer', { category: 'Animal', value: 'Morcego' });
  await new Promise((r) => setTimeout(r, 200));
  b.disconnect();
  console.log('✔ João desligou-se (simulando refresh/perda de rede)');
  await new Promise((r) => setTimeout(r, 500));

  const c = io(URL, { transports: ['websocket'] }); // nova ligação, mesmo sessionId
  const rejoined = await ack<{ ok: boolean; sessionId: string; error?: string }>(c, 'room:rejoin', {
    code: created.code,
    sessionId: joined.sessionId,
  });
  if (!rejoined.ok) throw new Error('Reconexão falhou: ' + rejoined.error);

  const stateAfterRejoin = await new Promise<any>((resolve) => {
    c.on('room:state', (s: any) => resolve(s));
  });
  console.log('✔ João reconectou-se. Estado:', stateAfterRejoin.state);
  console.log('✔ Resposta recuperada após reconexão:', stateAfterRejoin.myAnswers);

  if (stateAfterRejoin.myAnswers?.Animal !== 'Morcego') {
    throw new Error('A resposta não foi recuperada após a reconexão!');
  }
  const meInPlayers = stateAfterRejoin.players.find((p: any) => p.sessionId === joined.sessionId);
  if (!meInPlayers?.connected) throw new Error('Jogador não aparece como reconectado');

  console.log('✅ RECONEXÃO FUNCIONA CORRETAMENTE');
  a.disconnect();
  c.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ TESTE DE RECONEXÃO FALHOU:', err);
  process.exit(1);
});
