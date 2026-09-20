import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { emitWithAck, saveSession, socket } from '../socket';

type Mode = 'idle' | 'create' | 'join';

export default function Home() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<Mode>('idle');
  const [name, setName] = useState('');
  const [code, setCode] = useState(params.get('code') ?? '');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (params.get('code')) setMode('join');
  }, [params]);

  useEffect(() => {
    if (!socket.connected) socket.connect();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError('Escolhe um nome antes de criar a sala.');
    setLoading(true);
    const res = await emitWithAck<{ ok: boolean; code?: string; sessionId?: string; error?: string }>(
      'room:create',
      { name }
    );
    setLoading(false);
    if (!res.ok || !res.code || !res.sessionId) return setError(res.error ?? 'Não foi possível criar a sala.');
    saveSession({ code: res.code, sessionId: res.sessionId, name });
    navigate(`/room/${res.code}`);
  }

  async function handleJoin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError('Escolhe um nome antes de entrar na sala.');
    if (!code.trim()) return setError('Introduz o código da sala.');
    setLoading(true);
    const res = await emitWithAck<{ ok: boolean; code?: string; sessionId?: string; error?: string }>(
      'room:join',
      { code: code.trim().toUpperCase(), name }
    );
    setLoading(false);
    if (!res.ok || !res.code || !res.sessionId) return setError(res.error ?? 'Não foi possível entrar na sala.');
    saveSession({ code: res.code, sessionId: res.sessionId, name });
    navigate(`/room/${res.code}`);
  }

  return (
    <div className="relative min-h-screen overflow-hidden">
      <BackgroundLetters />

      <div className="relative z-10 flex min-h-screen flex-col items-center px-6 py-16">
        <header className="flex w-full max-w-4xl flex-col items-center text-center">
          <h1 className="font-display text-6xl font-semibold tracking-tight text-paper sm:text-7xl">
            Nome, <span className="text-gold">Terra</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-paper/80">
            Cria uma sala. Junta os teus amigos. Escolhe uma letra. Vê quem consegue pensar mais rápido.
          </p>
        </header>

        <div className="mt-12 w-full max-w-md">
          {mode === 'idle' && (
            <div className="flex flex-col gap-3">
              <button
                onClick={() => setMode('create')}
                className="rounded-xl bg-gold px-6 py-4 text-lg font-semibold text-ink transition hover:bg-gold-bright"
              >
                Criar sala
              </button>
              <button
                onClick={() => setMode('join')}
                className="rounded-xl border border-paper/25 bg-transparent px-6 py-4 text-lg font-semibold text-paper transition hover:border-paper/50"
              >
                Entrar numa sala
              </button>
              <button
                onClick={() => navigate('/como-jogar')}
                className="mt-2 text-sm text-paper/60 underline underline-offset-4 hover:text-paper"
              >
                Como jogar
              </button>
            </div>
          )}

          {mode === 'create' && (
            <form onSubmit={handleCreate} className="flex flex-col gap-3 animate-slide-up">
              <label className="text-sm text-paper/70" htmlFor="create-name">
                O teu nome
              </label>
              <input
                id="create-name"
                autoFocus
                maxLength={16}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Lazarinho"
                className="rounded-lg border border-paper/20 bg-ink-light px-4 py-3 text-paper placeholder:text-paper/40 focus:border-gold"
              />
              {error && <p className="text-sm text-coral">{error}</p>}
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode('idle')}
                  className="rounded-lg px-4 py-3 text-sm text-paper/60 hover:text-paper"
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 rounded-lg bg-gold px-4 py-3 font-semibold text-ink hover:bg-gold-bright disabled:opacity-60"
                >
                  {loading ? 'A criar sala...' : 'Criar sala'}
                </button>
              </div>
            </form>
          )}

          {mode === 'join' && (
            <form onSubmit={handleJoin} className="flex flex-col gap-3 animate-slide-up">
              <label className="text-sm text-paper/70" htmlFor="join-code">
                Código da sala
              </label>
              <input
                id="join-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="Ex: K7F2Q"
                maxLength={5}
                className="rounded-lg border border-paper/20 bg-ink-light px-4 py-3 tracking-[0.3em] text-paper placeholder:tracking-normal placeholder:text-paper/40 focus:border-gold"
              />
              <label className="text-sm text-paper/70" htmlFor="join-name">
                O teu nome
              </label>
              <input
                id="join-name"
                maxLength={16}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: João"
                className="rounded-lg border border-paper/20 bg-ink-light px-4 py-3 text-paper placeholder:text-paper/40 focus:border-gold"
              />
              {error && <p className="text-sm text-coral">{error}</p>}
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode('idle')}
                  className="rounded-lg px-4 py-3 text-sm text-paper/60 hover:text-paper"
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 rounded-lg bg-gold px-4 py-3 font-semibold text-ink hover:bg-gold-bright disabled:opacity-60"
                >
                  {loading ? 'A entrar...' : 'Entrar na sala'}
                </button>
              </div>
            </form>
          )}
        </div>

        <p className="mt-16 max-w-lg text-center text-sm text-paper/50">
          Nome, Terra é um jogo de palavras multiplayer em que todos recebem a mesma letra e tentam
          encontrar respostas para várias categorias antes do tempo acabar.
        </p>
      </div>
    </div>
  );
}

function BackgroundLetters() {
  const letters = ['M', 'A', 'T', 'R', 'S', 'N'];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden opacity-[0.06]">
      <div className="grid grid-cols-6 gap-8 p-8 font-display text-[9rem] font-bold leading-none text-paper">
        {letters.map((l, i) => (
          <span key={i} style={{ transform: `rotate(${(i % 2 === 0 ? -1 : 1) * 4}deg)` }}>
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}
