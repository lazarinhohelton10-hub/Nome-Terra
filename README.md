# Nome, Terra — multiplayer online

Jogo de palavras multiplayer em tempo real (também conhecido como Stop/Adedonha).
Cria uma sala, convida amigos por link ou código, recebe todos a mesma letra ao
mesmo tempo, responde antes do tempo acabar, valida as respostas uns dos outros
e acumula pontos ao longo de várias rondas.

Este é um monorepo com duas aplicações:

```
nome-terra/
├── server/   Node.js + TypeScript + Express + Socket.IO (autoridade do jogo)
└── client/   React + TypeScript + Vite + Tailwind (interface)
```

## Porque esta stack

- **Socket.IO** em vez de WebSockets nativos: dá reconexão automática,
  fallback para long-polling e um sistema de "ack" (confirmação com resposta)
  que tornou trivial implementar `room:create`/`room:join` como pedido-resposta
  sobre uma ligação que depois passa a ser passiva (broadcasts do servidor).
- **Estado em memória no servidor** (não uma base de dados) para a primeira
  versão: o briefing pede explicitamente que não seja obrigatório ter contas
  permanentes e que o MVP não sacrifique estabilidade por funcionalidades
  secundárias. Ver "Limitações conhecidas" abaixo para o que isto implica e
  como evoluir para Postgres/Redis mais tarde.
- **Vite + Tailwind**: build rápido, sem necessidade de um framework SSR como
  Next.js já que não há SEO de conteúdo dinâmico a servir (apenas a landing
  page e a página "Como jogar" beneficiam de SEO, e o Vite já as serve bem).

## Arquitetura e autoridade do servidor

O servidor é a única fonte de verdade. O cliente nunca decide o número de
rondas, quem controla cada ronda, o temporizador, o estado da ronda ou a
pontuação — só envia nomes, a letra escolhida (quando é a sua vez), respostas
e votos. Isto está implementado assim:

- `server/src/GameRoom.ts` — a máquina de estados de uma sala:
  `LOBBY → COUNTDOWN → CHOOSING_LETTER → PLAYING → REVIEW → SCORING → (COUNTDOWN | FINISHED)`.
  Sabe quem são os jogadores, a ordem de turnos, quem controla a ronda atual,
  que letra está em jogo, que letras já foram usadas, as respostas da ronda
  atual, o histórico de rondas e a pontuação.

### Regra de rondas por turnos

- **Número de rondas = número de jogadores ligados quando a partida começa.**
  Cada jogador escolhe a letra exatamente uma vez, numa ordem aleatória
  gerada nesse momento (não a ordem de entrada no lobby).
- Enquanto não é a tua vez, vês um ecrã de espera ("X está a escolher a
  letra..."); quando é a tua vez, escolhes uma letra ainda não usada e
  confirmas.
- **Só quem escolheu a letra dessa ronda pode carregar STOP.** Os outros
  jogadores só respondem.
- Se o responsável de uma ronda estiver desligado quando chega a sua vez, ou
  se desligar a meio da ronda e não voltar dentro do período de tolerância
  (`RECONNECT_GRACE_MS`), o controlo passa automaticamente para outro
  jogador ligado, e todos são avisados ("X assumiu o controlo desta ronda").
- Se o tempo esgotar sozinho (sem ninguém carregar STOP), o servidor encerra
  a ronda de qualquer forma — isto nunca depende do responsável estar
  presente.

- `server/src/RoomManager.ts` — guarda todas as salas ativas em memória e
  limpa salas vazias e inativas periodicamente.
- `server/src/scoring.ts` — motor de pontuação modular e testado
  isoladamente (`classic` 10/5/0, `differentiated` 20/10/0, `no_duplicates`
  10/0/0).
- `server/src/letters.ts` — baralhar a ordem dos jogadores (Fisher-Yates).
- `server/src/handlers.ts` — liga tudo isto aos eventos Socket.IO.

### Eventos Socket.IO

Cliente → Servidor (todos validados no servidor; um jogador só pode agir em
nome de si próprio, e ações de anfitrião são verificadas contra
`room.hostSessionId`):

| Evento | Payload | Notas |
|---|---|---|
| `room:create` | `{ name }` | resposta via *ack*: `{ ok, code, sessionId }` |
| `room:join` | `{ code, name }` | *ack* igual; valida sala cheia/inexistente/nome duplicado |
| `room:rejoin` | `{ code, sessionId }` | usado ao recarregar a página ou reconectar |
| `room:leave` | — | saída definitiva e voluntária |
| `room:update_settings` | `Partial<RoomSettings>` | só o anfitrião, só em `LOBBY` |
| `room:kick` | `{ targetSessionId }` | só o anfitrião |
| `game:start` | — | só o anfitrião, precisa de ≥2 jogadores ligados |
| `game:submit_answer` | `{ category, value }` | com *debounce* no cliente (200ms) |
| `game:choose_letter` | `{ letter }` | só o jogador responsável pela ronda (`controllerSessionId`), só em `CHOOSING_LETTER` |
| `game:stop` | — | só o jogador responsável pela ronda atual |
| `game:vote` | `{ category, targetSessionId, vote }` | nunca na própria resposta |
| `game:host_decide` | `{ category, targetSessionId, decision }` | só o anfitrião, só em empates |
| `game:force_finalize` | — | só o anfitrião, avança a validação mesmo incompleta |
| `game:next_round` | — | só o anfitrião |
| `game:rematch` | — | só o anfitrião, só em `FINISHED` |

Servidor → Cliente:

| Evento | Quando |
|---|---|
| `room:state` | broadcast principal (estado completo, adaptado a cada jogador) sempre que algo muda |
| `room:player_joined` / `room:player_left` | entradas/saídas |
| `room:player_disconnected` / `room:player_reconnected` | perdas de ligação temporárias |
| `room:kicked` | enviado só ao jogador expulso |
| `game:round_finished` | motivo: `stop` \| `timeout` \| `validated` |
| `game:controller_reassigned` | o responsável da ronda mudou (ausência/desistência) |
| `game:finished` | fim da partida |

### Sincronização do temporizador

O servidor envia `roundEndsAt` (um *timestamp* absoluto) em vez de "segundos
restantes". O cliente recalcula `roundEndsAt - Date.now()` a cada 250ms — por
isso um `F5` a meio da ronda continua a mostrar o tempo certo assim que
reconecta, sem depender do relógio local do browser ter estado a correr.

### Reconexão e refresh

Cada jogador tem um `sessionId` persistente (gerado pelo servidor,
independente do `socket.id`, que muda a cada ligação). O cliente guarda
`{ code, sessionId, name }` no `localStorage`. Ao abrir `/room/:code`:

1. Se não houver sessão guardada para essa sala, volta à Home a pedir nome.
2. Se houver, tenta `room:rejoin`. As respostas já submetidas nesta ronda
   ficam associadas ao `sessionId`, não ao `socket.id`, por isso sobrevivem à
   troca de ligação.

Se a ligação cai sem um refresh explícito, o servidor marca o jogador como
desligado, avisa a sala, e só o remove definitivamente ao fim de
`RECONNECT_GRACE_MS` (45s por omissão) sem ele voltar.

## Como correr localmente

Precisas de Node.js 18+ instalado.

### 1. Servidor

```bash
cd server
cp .env.example .env
npm install
npm run dev
```

Fica a correr em `http://localhost:4000` (a rota `/health` confirma que está
no ar).

### 2. Cliente

Numa segunda janela de terminal:

```bash
cd client
cp .env.example .env
npm install
npm run dev
```

Fica a correr em `http://localhost:5173`.

### 3. Testar o multiplayer com duas "pessoas"

Abre `http://localhost:5173` em duas janelas do browser (ou uma janela normal
e uma anónima/privada, para teres duas sessões de `localStorage`
independentes). Cria uma sala numa janela, copia o código, entra com a outra
janela, e joga — as duas devem ver o lobby, a letra, o temporizador e os
resultados sincronizados em tempo real.

## Testes automáticos

```bash
cd server
npm test              # testes unitários (Vitest): pontuação, máquina de estados, ordem de turnos e substituição
```

Há também quatro scripts que ligam **dois clientes Socket.IO reais** ao
servidor (não simulados) para confirmar o fluxo ponta-a-ponta, incluindo pela
rede:

```bash
cd server
npm run dev                        # numa janela, deixa o servidor a correr
npm run test:e2e                   # noutra janela: joga uma partida completa (2 jogadores = 2 rondas, cada um escolhe a sua letra)
npm run test:e2e:reconnect         # simula um jogador a perder a ligação a meio da ronda e a voltar
npm run test:e2e:timeout           # confirma que a ronda avança sozinha quando o tempo esgota sem ninguém carregar STOP
npm run test:e2e:substitution      # confirma que o controlo passa para outro jogador se o responsável se desligar
```

Todos foram corridos durante o desenvolvimento contra o servidor compilado e
passaram, confirmando: criação/entrada em sala, ordem de turnos aleatória,
escolha manual da letra pelo jogador responsável, STOP restrito a esse
jogador (o outro é ignorado), temporizador sincronizado pelo servidor,
votação (com a regra de não poder votar em si próprio), cálculo de pontos
(5+5 para uma resposta válida repetida), avanço de ronda, resultado final, e
recuperação de uma resposta já escrita depois de uma reconexão a meio da
ronda, e transferência de controlo quando o responsável se desliga.

## Variáveis de ambiente

Ver `server/.env.example` e `client/.env.example`. Resumo:

**server/.env**
```
PORT=4000
CLIENT_URL=http://localhost:5173
ROOM_TTL_MS=1800000
RECONNECT_GRACE_MS=45000
```

**client/.env**
```
VITE_SERVER_URL=http://localhost:4000
```

## Build de produção

```bash
cd server && npm run build && npm start   # compila para dist/ e corre node dist/index.js
cd client && npm run build                # gera client/dist/ (ficheiros estáticos)
```

## Deployment (sugestão, não obrigatória)

Nenhum destes serviços é necessário — qualquer host que corra um processo
Node.js persistente com WebSockets serve para o servidor, e qualquer host de
ficheiros estáticos serve para o cliente. Uma combinação simples:

- **Cliente**: Vercel, Netlify, ou Cloudflare Pages — aponta para
  `client/`, comando de build `npm run build`, pasta de saída `dist/`.
  Define `VITE_SERVER_URL` para o URL público do servidor.
- **Servidor**: Render, Railway ou Fly.io (precisam de suportar processos
  long-running com WebSockets, ao contrário de funções serverless puras).
  Comando de build `npm run build`, comando de arranque `npm start`. Define
  `CLIENT_URL` para o URL público do cliente (para o CORS do Socket.IO
  aceitar a ligação).
- **Base de dados**: não é necessária nesta versão (ver limitações abaixo).

## Limitações conhecidas

- **Estado só em memória**: reiniciar o processo do servidor apaga todas as
  salas ativas. Não há persistência entre reinícios nem histórico entre
  partidas diferentes.
- **Uma única instância**: como o estado vive na memória de um processo, não
  dá para correr múltiplas instâncias do servidor atrás de um load balancer
  sem partilhar esse estado (ex.: via Redis + o adaptador oficial
  `@socket.io/redis-adapter`). Para o volume de uma primeira versão isto não
  é um problema.
- **Sem contas de utilizador**: identificação é só por `sessionId` efémero.
  Não há estatísticas entre partidas, perfis, nem "amigos".
- **Validação automática é apenas uma sugestão visual** (`⚠ Sistema não
  reconheceu` / `✓ Sistema reconhece`), exatamente como o briefing pediu —
  nunca decide sozinha; a votação dos jogadores é sempre a autoridade final.
- **Sem chat, sons, QR code, ou reações** — deixados de fora do MVP de
  propósito (secção 61 do briefing), mas a arquitetura de eventos Socket.IO
  não impede de os adicionar depois.
- **Limite de 60 caracteres por resposta e 16 por nome** aplicado apenas
  como sanitização defensiva; não há um dicionário real para confirmar se uma
  palavra "existe" — isso fica sempre a cargo da votação humana, como o
  briefing exige explicitamente.

## Próximas melhorias recomendadas

1. Persistir salas e histórico em Postgres (Supabase/Neon), mantendo o
   `GameRoom` como está e só trocando o `RoomManager` para ler/escrever de
   uma base de dados.
2. Redis + `@socket.io/redis-adapter` para permitir escalar para várias
   instâncias do servidor.
3. Contas opcionais para guardar estatísticas ao longo do tempo (vitórias,
   pontuação média, taxa de respostas únicas).
4. Chat da sala e reações rápidas (a estrutura de eventos já tem espaço para
   `chat:message` sem tocar no resto).
5. QR code para entrar na sala (útil quando os jogadores estão no mesmo
   local físico).
6. Testes automatizados adicionais para os casos de disputa/empate na
   votação e para o cenário de desistência do responsável a meio da ronda.
