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
  await ack<{ ok: boolean }>(b, 'room:join', { code: created.code, name: 'João' });
  console.log('✔ Sala criada:', created.code);

  // ronda de apenas 2 segundos, para o tempo esgotar sozinho rapidamente
  a.emit('room:update_settings', { categories: ['Animal'], roundSeconds: 2 });
  await new Promise((r) => setTimeout(r, 200));
  a.emit('game:start');

  let reachedReviewA = false;
  let reachedReviewB = false;
  a.on('room:state', (s: any) => {
    if (s.state === 'REVIEW') reachedReviewA = true;
    // assim que alguém tem de escolher a letra, escolhe imediatamente para o teste avançar
    if (s.state === 'CHOOSING_LETTER' && s.controllerSessionId === created.sessionId) {
      a.emit('game:choose_letter', { letter: 'M' });
    }
  });
  b.on('room:state', (s: any) => {
    if (s.state === 'REVIEW') reachedReviewB = true;
    if (s.state === 'CHOOSING_LETTER' && s.controllerSessionId !== created.sessionId) {
      b.emit('game:choose_letter', { letter: 'M' });
    }
  });

  console.log('✔ Ronda a decorrer, ninguém vai carregar em STOP — a aguardar o tempo esgotar...');
  await new Promise((r) => setTimeout(r, 7000)); // 2s de ronda + 3s de countdown + margem

  if (!reachedReviewA || !reachedReviewB) {
    throw new Error(
      `Depois do tempo esgotar sozinho, os clientes NÃO chegaram a REVIEW (a=${reachedReviewA}, b=${reachedReviewB}) — o bug persiste.`
    );
  }
  console.log('✅ Ambos os jogadores chegaram à fase de validação sozinhos, sem ninguém carregar em STOP');

  a.disconnect();
  b.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ TESTE FALHOU:', err);
  process.exit(1);
});
