import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { clearSession, emitWithAck, loadSession, saveSession, socket } from '../socket';
import type { CategoryEntryPublic, PublicRoomState, VoteValue } from '../types';

const ALL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const ROUND_OPTIONS = [5, 10, 15, 20];
const TIME_OPTIONS = [30, 45, 60, 90, 120];

export default function Room() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<PublicRoomState | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [connError, setConnError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);
  const bannerTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showBanner = useCallback((msg: string) => {
    setBanner(msg);
    if (bannerTimeout.current) clearTimeout(bannerTimeout.current);
    bannerTimeout.current = setTimeout(() => setBanner(null), 3500);
  }, []);

  useEffect(() => {
    const stored = loadSession();
    if (!stored || stored.code !== code.toUpperCase()) {
      navigate(`/?code=${code}`);
      return;
    }

    if (!socket.connected) socket.connect();

    async function attemptRejoin() {
      const res = await emitWithAck<{ ok: boolean; sessionId?: string; error?: string }>('room:rejoin', {
        code: code.toUpperCase(),
        sessionId: stored!.sessionId,
      });
      if (!res.ok) {
        clearSession();
        navigate(`/?code=${code}`);
        return;
      }
      setSessionId(res.sessionId ?? stored!.sessionId);
    }

    attemptRejoin();

    function onState(s: PublicRoomState) {
      setState(s);
      setConnError(null);
    }
    function onPlayerJoined(p: { name: string }) {
      showBanner(`${p.name} entrou na sala.`);
    }
    function onPlayerLeft(p: { name: string }) {
      showBanner(`${p.name} saiu da sala.`);
    }
    function onPlayerDisconnected(p: { name: string }) {
      showBanner(`${p.name} desconectou-se.`);
    }
    function onPlayerReconnected(p: { name: string }) {
      showBanner(`${p.name} voltou à sala.`);
    }
    function onKicked() {
      clearSession();
      navigate('/');
    }
    function onRoundFinished(payload: { reason: string; by?: string }) {
      if (payload.reason === 'stop') showBanner(`${payload.by} carregou em STOP!`);
      else if (payload.reason === 'timeout') showBanner('Tempo esgotado!');
    }
    function onDisconnect() {
      setConnectionLost(true);
    }
    function onConnect() {
      setConnectionLost(false);
    }
    function onConnectError() {
      setConnError('Não foi possível ligar ao servidor. Verifica a tua ligação.');
    }

    socket.on('room:state', onState);
    socket.on('room:player_joined', onPlayerJoined);
    socket.on('room:player_left', onPlayerLeft);
    socket.on('room:player_disconnected', onPlayerDisconnected);
    socket.on('room:player_reconnected', onPlayerReconnected);
    socket.on('room:kicked', onKicked);
    socket.on('game:round_finished', onRoundFinished);
    socket.on('disconnect', onDisconnect);
    socket.on('connect', onConnect);
    socket.on('connect_error', onConnectError);

    return () => {
      socket.off('room:state', onState);
      socket.off('room:player_joined', onPlayerJoined);
      socket.off('room:player_left', onPlayerLeft);
      socket.off('room:player_disconnected', onPlayerDisconnected);
      socket.off('room:player_reconnected', onPlayerReconnected);
      socket.off('room:kicked', onKicked);
      socket.off('game:round_finished', onRoundFinished);
      socket.off('disconnect', onDisconnect);
      socket.off('connect', onConnect);
      socket.off('connect_error', onConnectError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  if (connError) {
    return <CenteredMessage title="Ups." message={connError} />;
  }
  if (!state || !sessionId) {
    return <CenteredMessage title="A entrar na sala..." message="Um momento." />;
  }

  const me = state.players.find((p) => p.sessionId === sessionId);
  const isHost = me?.isHost ?? false;

  return (
    <div className="min-h-screen px-4 py-8 sm:px-8">
      {connectionLost && (
        <div className="fixed inset-x-0 top-0 z-50 bg-coral py-2 text-center text-sm font-medium text-ink">
          Ligação perdida... a tentar reconectar.
        </div>
      )}
      {banner && (
        <div className="fixed left-1/2 top-4 z-40 -translate-x-1/2 animate-slide-up rounded-full bg-ink-lighter px-5 py-2 text-sm text-paper shadow-lg">
          {banner}
        </div>
      )}

      <div className="mx-auto max-w-4xl">
        <RoomHeader code={state.code} state={state.state} round={state.currentRound} totalRounds={state.totalRounds} />

        {state.state === 'LOBBY' && (
          <Lobby state={state} isHost={isHost} mySessionId={sessionId} onLeave={() => leaveRoom(navigate)} />
        )}
        {state.state === 'COUNTDOWN' && <Countdown />}
        {state.state === 'PLAYING' && <PlayingScreen state={state} mySessionId={sessionId} />}
        {state.state === 'REVIEW' && <ReviewScreen state={state} mySessionId={sessionId} isHost={isHost} />}
        {state.state === 'SCORING' && (
          <ScoringScreen state={state} mySessionId={sessionId} isHost={isHost} />
        )}
        {state.state === 'FINISHED' && (
          <FinishedScreen state={state} isHost={isHost} onLeave={() => leaveRoom(navigate)} />
        )}
      </div>
    </div>
  );
}

function leaveRoom(navigate: ReturnType<typeof useNavigate>) {
  socket.emit('room:leave');
  clearSession();
  navigate('/');
}

function CenteredMessage({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <h1 className="font-display text-3xl font-semibold text-paper">{title}</h1>
      <p className="mt-3 text-paper/70">{message}</p>
    </div>
  );
}

function RoomHeader({
  code,
  state,
  round,
  totalRounds,
}: {
  code: string;
  state: string;
  round: number;
  totalRounds: number;
}) {
  return (
    <div className="mb-8 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className="font-display text-xl font-semibold text-paper">Nome, Terra</span>
        <span className="rounded-full border border-paper/20 px-3 py-1 text-xs tracking-wide text-paper/60">
          Sala {code}
        </span>
      </div>
      {state !== 'LOBBY' && state !== 'FINISHED' && (
        <span className="text-sm text-paper/60">
          Ronda {round}/{totalRounds}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LOBBY
// ---------------------------------------------------------------------------

function Lobby({
  state,
  isHost,
  mySessionId,
  onLeave,
}: {
  state: PublicRoomState;
  isHost: boolean;
  mySessionId: string;
  onLeave: () => void;
}) {
  const inviteLink = `${window.location.origin}/room/${state.code}`;
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  async function copy(text: string, which: 'code' | 'link') {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // clipboard indisponível (ex.: contexto não seguro); falha em silêncio
    }
  }

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Nome, Terra', text: 'Junta-te à minha sala!', url: inviteLink });
      } catch {
        // utilizador cancelou a partilha
      }
    } else {
      copy(inviteLink, 'link');
    }
  }

  const connectedCount = state.players.filter((p) => p.connected).length;
  const canStart = isHost && connectedCount >= 2;

  return (
    <div className="grid gap-8 sm:grid-cols-[1.2fr_1fr]">
      <div>
        <div className="rounded-2xl border border-paper/10 bg-ink-light p-6">
          <p className="text-sm text-paper/60">Convida os teus amigos</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="rounded-lg bg-ink px-4 py-2 text-2xl tracking-[0.3em] text-gold">{state.code}</code>
            <button
              onClick={() => copy(state.code, 'code')}
              className="rounded-lg border border-paper/20 px-3 py-2 text-sm hover:border-paper/40"
            >
              {copied === 'code' ? 'Copiado!' : 'Copiar código'}
            </button>
            <button
              onClick={share}
              className="rounded-lg bg-gold px-3 py-2 text-sm font-semibold text-ink hover:bg-gold-bright"
            >
              🔗 Convidar amigos
            </button>
          </div>
          {copied === 'link' && <p className="mt-2 text-xs text-mint">Link copiado!</p>}
        </div>

        <div className="mt-6 rounded-2xl border border-paper/10 bg-ink-light p-6">
          <div className="flex items-center justify-between">
            <p className="text-sm text-paper/60">{connectedCount} jogador(es)</p>
          </div>
          <ul className="mt-3 flex flex-col gap-2">
            {state.players.map((p) => (
              <li
                key={p.sessionId}
                className="flex items-center justify-between rounded-lg bg-ink px-4 py-2.5"
              >
                <span className="flex items-center gap-2">
                  <span className={p.connected ? 'text-mint' : 'text-paper/30'}>●</span>
                  <span className="text-paper">
                    {p.isHost && '👑 '}
                    {p.name}
                    {p.sessionId === mySessionId && ' (tu)'}
                  </span>
                </span>
                {isHost && p.sessionId !== mySessionId && (
                  <button
                    onClick={() => socket.emit('room:kick', { targetSessionId: p.sessionId })}
                    className="text-xs text-paper/40 hover:text-coral"
                  >
                    Expulsar
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>

        <button onClick={onLeave} className="mt-6 text-sm text-paper/50 hover:text-paper">
          Sair da sala
        </button>
      </div>

      <div>
        {isHost ? (
          <SettingsPanel settings={state.settings} canStart={canStart} connectedCount={connectedCount} />
        ) : (
          <div className="rounded-2xl border border-paper/10 bg-ink-light p-6 text-paper/70">
            <p>À espera que o anfitrião inicie a partida.</p>
            <SettingsSummary settings={state.settings} />
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsSummary({ settings }: { settings: PublicRoomState['settings'] }) {
  return (
    <ul className="mt-4 flex flex-col gap-1 text-sm text-paper/50">
      <li>{settings.totalRounds} rondas</li>
      <li>{settings.roundSeconds}s por ronda</li>
      <li>Categorias: {settings.categories.join(', ')}</li>
    </ul>
  );
}

function SettingsPanel({
  settings,
  canStart,
  connectedCount,
}: {
  settings: PublicRoomState['settings'];
  canStart: boolean;
  connectedCount: number;
}) {
  const [newCategory, setNewCategory] = useState('');

  function update(partial: Partial<PublicRoomState['settings']>) {
    socket.emit('room:update_settings', partial);
  }

  function addCategory() {
    const val = newCategory.trim();
    if (!val || settings.categories.includes(val)) return;
    update({ categories: [...settings.categories, val] });
    setNewCategory('');
  }

  function removeCategory(cat: string) {
    if (settings.categories.length <= 1) return;
    update({ categories: settings.categories.filter((c) => c !== cat) });
  }

  function toggleLetter(letter: string) {
    const enabled = settings.enabledLetters.includes(letter);
    const next = enabled
      ? settings.enabledLetters.filter((l) => l !== letter)
      : [...settings.enabledLetters, letter];
    if (next.length === 0) return; // nunca ficar sem letras
    update({ enabledLetters: next });
  }

  return (
    <div className="rounded-2xl border border-paper/10 bg-ink-light p-6">
      <p className="text-sm font-semibold text-paper">Configuração da partida</p>

      <Field label="Número de rondas">
        <div className="flex flex-wrap gap-2">
          {ROUND_OPTIONS.map((n) => (
            <Pill key={n} active={settings.totalRounds === n} onClick={() => update({ totalRounds: n })}>
              {n}
            </Pill>
          ))}
        </div>
      </Field>

      <Field label="Tempo por ronda">
        <div className="flex flex-wrap gap-2">
          {TIME_OPTIONS.map((s) => (
            <Pill key={s} active={settings.roundSeconds === s} onClick={() => update({ roundSeconds: s })}>
              {s}s
            </Pill>
          ))}
        </div>
      </Field>

      <Field label="Categorias">
        <div className="flex flex-wrap gap-2">
          {settings.categories.map((c) => (
            <span
              key={c}
              className="flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-sm text-paper"
            >
              {c}
              <button onClick={() => removeCategory(c)} className="text-paper/40 hover:text-coral">
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCategory())}
            placeholder="Nova categoria"
            maxLength={24}
            className="flex-1 rounded-lg border border-paper/20 bg-ink px-3 py-2 text-sm text-paper placeholder:text-paper/40"
          />
          <button onClick={addCategory} className="rounded-lg border border-paper/20 px-3 text-sm hover:border-paper/40">
            + Adicionar
          </button>
        </div>
      </Field>

      <Field label="Pontuação">
        <select
          value={settings.scoringMode}
          onChange={(e) => update({ scoringMode: e.target.value as PublicRoomState['settings']['scoringMode'] })}
          className="w-full rounded-lg border border-paper/20 bg-ink px-3 py-2 text-sm text-paper"
        >
          <option value="classic">Clássico — 10 / 5 / 0</option>
          <option value="differentiated">Diferenciado — 20 / 10 / 0</option>
          <option value="no_duplicates">Sem duplicados — 10 / 0 / 0</option>
        </select>
      </Field>

      <Field label="Letras em jogo">
        <div className="flex flex-wrap gap-1.5">
          {ALL_LETTERS.map((l) => (
            <button
              key={l}
              onClick={() => toggleLetter(l)}
              className={`h-8 w-8 rounded-md text-sm font-semibold transition ${
                settings.enabledLetters.includes(l)
                  ? 'bg-gold text-ink'
                  : 'bg-ink text-paper/30 hover:text-paper/60'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </Field>

      <button
        disabled={!canStart}
        onClick={() => socket.emit('game:start')}
        className="mt-6 w-full rounded-xl bg-gold py-4 text-lg font-semibold text-ink hover:bg-gold-bright disabled:cursor-not-allowed disabled:opacity-40"
      >
        Iniciar jogo
      </button>
      {connectedCount < 2 && <p className="mt-2 text-center text-xs text-paper/40">Precisas de pelo menos 2 jogadores.</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <p className="mb-2 text-xs text-paper/50">{label}</p>
      {children}
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3.5 py-1.5 text-sm transition ${
        active ? 'bg-gold text-ink font-semibold' : 'bg-ink text-paper/60 hover:text-paper'
      }`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// COUNTDOWN
// ---------------------------------------------------------------------------

function Countdown() {
  const [n, setN] = useState(3);
  useEffect(() => {
    const id = setInterval(() => setN((v) => Math.max(0, v - 1)), 900);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <p className="font-display text-9xl font-bold text-gold animate-letter-pop" key={n}>
        {n > 0 ? n : 'Já!'}
      </p>
      <p className="mt-4 text-paper/60">Prepara-te...</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PLAYING
// ---------------------------------------------------------------------------

function PlayingScreen({ state, mySessionId }: { state: PublicRoomState; mySessionId: string }) {
  const [answers, setAnswers] = useState<Record<string, string>>(state.myAnswers ?? {});
  const [secondsLeft, setSecondsLeft] = useState(0);
  const debounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    setAnswers(state.myAnswers ?? {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.currentLetter]);

  useEffect(() => {
    function tick() {
      if (!state.roundEndsAt) return;
      setSecondsLeft(Math.max(0, Math.ceil((state.roundEndsAt - Date.now()) / 1000)));
    }
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [state.roundEndsAt]);

  function handleChange(category: string, value: string) {
    setAnswers((prev) => ({ ...prev, [category]: value }));
    clearTimeout(debounceRef.current[category]);
    debounceRef.current[category] = setTimeout(() => {
      socket.emit('game:submit_answer', { category, value });
    }, 200);
  }

  const stopperName = state.players.find((p) => p.sessionId !== mySessionId)?.name;

  return (
    <div>
      <div className="mb-8 flex flex-col items-center">
        <p className="text-sm uppercase tracking-widest text-paper/50">A letra é</p>
        <p key={state.currentLetter} className="font-display text-8xl font-bold text-gold animate-letter-pop">
          {state.currentLetter}
        </p>
        <p className={`mt-2 font-display text-3xl ${secondsLeft <= 10 ? 'text-coral' : 'text-paper/70'}`}>
          {formatTime(secondsLeft)}
        </p>
      </div>

      <div className="mx-auto flex max-w-lg flex-col gap-3">
        {state.settings.categories.map((cat) => (
          <div key={cat}>
            <label className="mb-1 block text-xs text-paper/50">{cat}</label>
            <input
              value={answers[cat] ?? ''}
              onChange={(e) => handleChange(cat, e.target.value)}
              placeholder={`${state.currentLetter}...`}
              className="w-full rounded-lg border border-paper/15 bg-ink-light px-4 py-3 text-lg text-paper placeholder:text-paper/25 focus:border-gold"
            />
          </div>
        ))}
      </div>

      <div className="mt-8 flex justify-center">
        <button
          onClick={() => socket.emit('game:stop')}
          className="rounded-full bg-coral px-10 py-4 text-xl font-bold text-ink shadow-lg transition hover:brightness-110"
        >
          🛑 STOP
        </button>
      </div>
      <p className="mt-3 text-center text-xs text-paper/40">
        Qualquer jogador pode carregar STOP{stopperName ? '' : ''} para terminar a ronda mais cedo.
      </p>
    </div>
  );
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

// ---------------------------------------------------------------------------
// REVIEW (validação / votação)
// ---------------------------------------------------------------------------

function ReviewScreen({
  state,
  mySessionId,
  isHost,
}: {
  state: PublicRoomState;
  mySessionId: string;
  isHost: boolean;
}) {
  const [myVotes, setMyVotes] = useState<Record<string, VoteValue>>({});

  function vote(category: string, targetSessionId: string, v: VoteValue) {
    const key = `${category}:${targetSessionId}`;
    setMyVotes((prev) => ({ ...prev, [key]: v }));
    socket.emit('game:vote', { category, targetSessionId, vote: v });
  }

  if (!state.review) return null;

  return (
    <div>
      <h2 className="text-center font-display text-3xl font-semibold text-paper">Validar respostas</h2>
      <p className="mb-6 text-center text-sm text-paper/50">
        Não podes validar as tuas próprias respostas. A maioria decide.
      </p>

      <div className="flex flex-col gap-6">
        {state.review.categories.map((cat) => (
          <div key={cat.category} className="rounded-2xl border border-paper/10 bg-ink-light p-5">
            <p className="mb-3 text-xs uppercase tracking-widest text-paper/50">{cat.category}</p>
            <div className="flex flex-col gap-2">
              {cat.entries.length === 0 && <p className="text-sm text-paper/30">Ninguém respondeu.</p>}
              {cat.entries.map((entry) => {
                const isMine = entry.sessionId === mySessionId;
                const key = `${cat.category}:${entry.sessionId}`;
                const myVote = myVotes[key];
                return (
                  <div key={entry.sessionId} className="rounded-lg bg-ink px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-paper">{entry.answer || <em className="text-paper/30">(vazio)</em>}</span>
                        <span className="ml-2 text-xs text-paper/40">— {entry.playerName}</span>
                      </div>
                      <StatusBadge entry={entry} />
                    </div>
                    {!entry.systemRecognized && entry.answer && (
                      <p className="mt-1 text-xs text-paper/40">⚠ Sistema não reconheceu automaticamente</p>
                    )}
                    {entry.answer && !isMine && (
                      <div className="mt-2 flex items-center gap-2">
                        <button
                          onClick={() => vote(cat.category, entry.sessionId, 'accept')}
                          className={`rounded-md px-3 py-1 text-xs font-semibold ${
                            myVote === 'accept' ? 'bg-mint text-ink' : 'bg-ink-lighter text-paper/70 hover:text-paper'
                          }`}
                        >
                          ✓ Aceitar
                        </button>
                        <button
                          onClick={() => vote(cat.category, entry.sessionId, 'reject')}
                          className={`rounded-md px-3 py-1 text-xs font-semibold ${
                            myVote === 'reject' ? 'bg-coral text-ink' : 'bg-ink-lighter text-paper/70 hover:text-paper'
                          }`}
                        >
                          ✕ Rejeitar
                        </button>
                        <span className="text-xs text-paper/30">
                          {entry.acceptCount} ✓ · {entry.rejectCount} ✕ de {entry.totalVoters}
                        </span>
                      </div>
                    )}
                    {isMine && <p className="mt-1 text-xs text-paper/30">Não podes votar na tua própria resposta.</p>}
                    {entry.valid === 'disputed' && isHost && (
                      <div className="mt-2 flex items-center gap-2 rounded-md bg-ink-lighter p-2">
                        <span className="text-xs text-gold">⚠️ Empate — decisão do anfitrião:</span>
                        <button
                          onClick={() =>
                            socket.emit('game:host_decide', {
                              category: cat.category,
                              targetSessionId: entry.sessionId,
                              decision: 'accept',
                            })
                          }
                          className="rounded-md bg-mint px-2 py-1 text-xs font-semibold text-ink"
                        >
                          Aceitar
                        </button>
                        <button
                          onClick={() =>
                            socket.emit('game:host_decide', {
                              category: cat.category,
                              targetSessionId: entry.sessionId,
                              decision: 'reject',
                            })
                          }
                          className="rounded-md bg-coral px-2 py-1 text-xs font-semibold text-ink"
                        >
                          Rejeitar
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {isHost && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={() => socket.emit('game:force_finalize')}
            className="rounded-lg border border-paper/20 px-4 py-2 text-sm text-paper/70 hover:border-paper/40"
          >
            Terminar validação agora
          </button>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ entry }: { entry: CategoryEntryPublic }) {
  if (!entry.answer) return null;
  if (entry.valid === true) return <span className="text-xs font-semibold text-mint">✓ Válida</span>;
  if (entry.valid === false) return <span className="text-xs font-semibold text-coral">✕ Inválida</span>;
  if (entry.valid === 'disputed') return <span className="text-xs font-semibold text-gold">⚠️ Disputada</span>;
  return <span className="text-xs text-paper/30">⏳ A votar</span>;
}

// ---------------------------------------------------------------------------
// SCORING
// ---------------------------------------------------------------------------

function ScoringScreen({
  state,
  isHost,
}: {
  state: PublicRoomState;
  mySessionId: string;
  isHost: boolean;
}) {
  if (!state.scoring) return null;
  const sortedDelta = Object.entries(state.scoring.roundDelta).sort((a, b) => b[1] - a[1]);
  const medals = ['🥇', '🥈', '🥉'];

  return (
    <div className="flex flex-col items-center">
      <h2 className="font-display text-3xl font-semibold text-paper">Resultados da ronda</h2>
      <div className="mt-6 flex w-full max-w-sm flex-col gap-2">
        {sortedDelta.map(([sessionId, delta], i) => {
          const player = state.players.find((p) => p.sessionId === sessionId);
          return (
            <div
              key={sessionId}
              className="flex items-center justify-between rounded-lg bg-ink-light px-4 py-3"
            >
              <span className="text-paper">
                {medals[i] ?? `${i + 1}º`} {player?.name ?? '???'}
              </span>
              <span className="font-display font-semibold text-gold">+{delta}</span>
            </div>
          );
        })}
      </div>

      <h3 className="mt-10 text-sm uppercase tracking-widest text-paper/50">Classificação geral</h3>
      <div className="mt-3 flex w-full max-w-sm flex-col gap-1.5">
        {state.scoring.ranking.map((p, i) => (
          <div key={p.sessionId} className="flex items-center justify-between px-4 py-1.5 text-sm">
            <span className="text-paper/80">
              {i + 1}º {p.name}
            </span>
            <span className="text-paper/60">{p.totalScore} pts</span>
          </div>
        ))}
      </div>

      {isHost ? (
        <button
          onClick={() => socket.emit('game:next_round')}
          className="mt-8 rounded-xl bg-gold px-8 py-3 font-semibold text-ink hover:bg-gold-bright"
        >
          {state.currentRound < state.totalRounds ? 'Próxima ronda' : 'Ver resultado final'}
        </button>
      ) : (
        <p className="mt-8 text-sm text-paper/50">À espera que o anfitrião avance...</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FINISHED
// ---------------------------------------------------------------------------

function FinishedScreen({
  state,
  isHost,
  onLeave,
}: {
  state: PublicRoomState;
  isHost: boolean;
  onLeave: () => void;
}) {
  if (!state.finished) return null;
  const medals = ['🥇', '🥈', '🥉'];
  const topScore = state.finished.ranking[0]?.totalScore ?? 0;

  return (
    <div className="flex flex-col items-center">
      <h2 className="font-display text-4xl font-semibold text-paper">Fim do jogo</h2>
      <div className="mt-8 flex w-full max-w-md flex-col gap-2">
        {state.finished.ranking.map((p, i) => (
          <div
            key={p.sessionId}
            className={`rounded-xl px-5 py-4 ${
              p.totalScore === topScore ? 'bg-gold text-ink' : 'bg-ink-light text-paper'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold">
                {medals[i] ?? `${i + 1}º`} {p.name} {p.totalScore === topScore && '👑'}
              </span>
              <span className="font-display text-xl font-bold">{p.totalScore} pts</span>
            </div>
            <p className="mt-1 text-xs opacity-70">
              {p.validAnswers} respostas válidas · {p.uniqueAnswers} únicas · {p.roundsWon} rondas vencidas
            </p>
          </div>
        ))}
      </div>

      <div className="mt-8 flex gap-3">
        {isHost && (
          <button
            onClick={() => socket.emit('game:rematch')}
            className="rounded-xl bg-gold px-6 py-3 font-semibold text-ink hover:bg-gold-bright"
          >
            Jogar novamente
          </button>
        )}
        <button onClick={onLeave} className="rounded-xl border border-paper/20 px-6 py-3 text-paper hover:border-paper/40">
          Sair da sala
        </button>
      </div>
    </div>
  );
}
