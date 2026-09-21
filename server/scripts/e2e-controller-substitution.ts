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
  const joined = await ack<{ ok: boolean; sessionId: string }>(b, 'room:join', {
    code: created.code,
    name: 'João',
  });

  a.emit('room:update_settings', { categories: ['Animal'], roundSeconds: 60 });
  await new Promise((r) => setTimeout(r, 200));
  a.emit('game:start');

  const choosing = await new Promise<any>((resolve) => {
    a.on('room:state', (s: any) => {
      if (s.state === 'CHOOSING_LETTER' && s.controllerSessionId) resolve(s);
    });
  });
  console.log('✔ Responsável inicial:', choosing.controllerName);

  const controllerIsA = choosing.controllerSessionId === created.sessionId;
  const controllerSocket = controllerIsA ? a : b;
  const otherSocket = controllerIsA ? b : a;
  const otherName = controllerIsA ? 'João' : 'Lazarinho';

  let reassignedTo: string | null = null;
  otherSocket.on('game:controller_reassigned', (p: any) => {
    reassignedTo = p.name;
  });

  console.log(`✔ ${controllerIsA ? 'Lazarinho' : 'João'} vai desligar-se ANTES de escolher a letra`);
  controllerSocket.disconnect();

  // espera mais do que o RECONNECT_GRACE_MS (45s por omissão no .env.example,
  // mas testamos com o valor configurado no ambiente atual)
  await new Promise((r) => setTimeout(r, 3000));

  const stateAfter = await new Promise<any>((resolve) => {
    otherSocket.once('room:state', (s: any) => resolve(s));
  });
  // força um pedido de estado atual assim que o timer de reconexão expirar
  console.log('✔ A aguardar o período de tolerância expirar (isto demora um pouco)...');

  await new Promise((resolve) => {
    const check = setInterval(() => {
      if (reassignedTo) {
        clearInterval(check);
        resolve(null);
      }
    }, 500);
    setTimeout(() => {
      clearInterval(check);
      resolve(null);
    }, 60_000);
  });

  if (reassignedTo !== otherName) {
    throw new Error(`Controlo não foi transferido corretamente. Esperado: ${otherName}, recebido: ${reassignedTo}`);
  }
  console.log(`✅ Controlo transferido corretamente para ${reassignedTo} após o responsável se desligar`);

  otherSocket.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ TESTE DE SUBSTITUIÇÃO FALHOU:', err);
  process.exit(1);
});
