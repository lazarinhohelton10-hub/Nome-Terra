import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { RoomManager } from './RoomManager.js';
import { registerHandlers } from './handlers.js';

const PORT = Number(process.env.PORT ?? 4000);
const CLIENT_URL = process.env.CLIENT_URL ?? 'http://localhost:5173';
const ROOM_TTL_MS = Number(process.env.ROOM_TTL_MS ?? 30 * 60_000);

const app = express();
app.use(cors({ origin: CLIENT_URL }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'nome-terra-server', time: new Date().toISOString() });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: CLIENT_URL, methods: ['GET', 'POST'] },
});

const rooms = new RoomManager(ROOM_TTL_MS);
registerHandlers(io, rooms);

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Nome, Terra server a correr em http://localhost:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`À espera de ligações do frontend em ${CLIENT_URL}`);
});
