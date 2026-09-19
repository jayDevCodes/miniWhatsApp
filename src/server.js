import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createApp, joinConversationForSocket } from './app.js';
import { connectDatabase, disconnectDatabase } from './db.js';
import { env } from './config.js';
import { parseCookies, userFromToken } from './security.js';
import { createMessageSchema, editMessageSchema, validateSocketPayload } from './socket-validation.js';
import { sendMessage, editMessage, deleteMessage, markRead } from './services.js';

const httpServer = createServer();
const io = new Server(httpServer, {
  connectionStateRecovery: { maxDisconnectionDuration: 120000, skipMiddlewares: false },
  transports: ['websocket', 'polling'],
});
const app = createApp(io);
httpServer.on('request', app);

io.use(async (socket, next) => {
  try {
    const result = await userFromToken(parseCookies(socket.handshake.headers.cookie).sid);
    if (!result) return next(new Error('UNAUTHENTICATED'));
    socket.user = result.user;
    next();
  } catch (error) { next(error); }
});

const onlineCounts = new Map();

io.on('connection', (socket) => {
  const userId = String(socket.user._id);
  onlineCounts.set(userId, (onlineCounts.get(userId) || 0) + 1);
  socket.join('user:' + userId);
  io.emit('presence:changed', { userId, online: true });

  socket.on('conversation:join', async (payload, ack = () => {}) => {
    try {
      const conversation = await joinConversationForSocket(socket, payload?.conversationId);
      ack({ ok: true, conversationId: String(conversation._id) });
    } catch (error) { ack({ ok: false, error: error.message }); }
  });

  socket.on('message:send', async (payload, ack = () => {}) => {
    try {
      const input = validateSocketPayload(createMessageSchema, payload);
      const result = await sendMessage(input.conversationId, socket.user._id, input);
      if (!result.duplicate) io.to('conversation:' + input.conversationId).emit('message:new', result.message);
      ack({ ok: true, ...result });
    } catch (error) { ack({ ok: false, error: error.message }); }
  });

  socket.on('message:edit', async (payload, ack = () => {}) => {
    try {
      const input = validateSocketPayload(editMessageSchema, payload);
      const message = await editMessage(payload.messageId, socket.user._id, input.body);
      io.to('conversation:' + message.conversationId).emit('message:updated', message);
      ack({ ok: true, message });
    } catch (error) { ack({ ok: false, error: error.message }); }
  });

  socket.on('message:delete', async (payload, ack = () => {}) => {
    try {
      const message = await deleteMessage(payload?.messageId, socket.user._id);
      io.to('conversation:' + message.conversationId).emit('message:deleted', message);
      ack({ ok: true, message });
    } catch (error) { ack({ ok: false, error: error.message }); }
  });

  socket.on('typing:start', async (payload) => {
    try {
      const conversation = await joinConversationForSocket(socket, payload?.conversationId);
      socket.to('conversation:' + conversation._id).emit('typing:started', { conversationId: String(conversation._id), userId });
    } catch {}
  });

  socket.on('typing:stop', async (payload) => {
    try {
      const conversation = await joinConversationForSocket(socket, payload?.conversationId);
      socket.to('conversation:' + conversation._id).emit('typing:stopped', { conversationId: String(conversation._id), userId });
    } catch {}
  });

  socket.on('message:read', async (payload, ack = () => {}) => {
    try {
      const result = await markRead(payload?.conversationId, socket.user._id);
      io.to('conversation:' + result.conversationId).emit('message:read', result);
      ack({ ok: true, ...result });
    } catch (error) { ack({ ok: false, error: error.message }); }
  });

  socket.on('disconnect', async () => {
    const nextCount = Math.max((onlineCounts.get(userId) || 1) - 1, 0);
    if (nextCount === 0) {
      onlineCounts.delete(userId);
      socket.user.lastSeenAt = new Date();
      await socket.user.save().catch(() => {});
      io.emit('presence:changed', { userId, online: false });
    } else { onlineCounts.set(userId, nextCount); }
  });
});

async function start() {
  await connectDatabase();
  app.locals.dbReady = true;
  httpServer.listen(env.PORT, () => console.log('miniWhatsApp running at http://localhost:' + env.PORT));
}

async function shutdown(signal) {
  console.log(signal + ': shutting down...');
  app.locals.dbReady = false;
  await new Promise((resolve) => httpServer.close(resolve));
  await io.close();
  await disconnectDatabase();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

start().catch((error) => { console.error('Failed to start server:', error); process.exit(1); });