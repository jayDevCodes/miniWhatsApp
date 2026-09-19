import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { env } from './config.js';
import { parseCookies, sessionCookie, clearSessionCookie, userFromToken } from './security.js';
import { User } from './models.js';
import { registerUser, loginUser, logoutUser, listConversations, directConversation, listMessages, sendMessage, editMessage, deleteMessage, markRead } from './services.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '../public');
const viewsDir = path.resolve(__dirname, '../views');

const registerSchema = z.object({
  username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
  displayName: z.string().trim().min(1).max(80).optional(),
});
const loginSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(128) });
const directSchema = z.object({ userId: z.string().min(1) });
const sendSchema = z.object({ body: z.string().trim().min(1).max(4000), clientMessageId: z.string().min(8).max(100) });
const editSchema = z.object({ body: z.string().trim().min(1).max(4000) });

function parseBody(schema, value) {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const error = new Error('Request data is invalid.');
  error.status = 400; error.code = 'VALIDATION_ERROR'; error.details = parsed.error.issues;
  throw error;
}

function publicUser(user) {
  return { id: String(user._id), username: user.username, email: user.email, displayName: user.displayName || user.username, avatarUrl: user.avatarUrl || null, lastSeenAt: user.lastSeenAt || null };
}

async function requireUser(req, res, next) {
  try {
    const result = await userFromToken(parseCookies(req.headers.cookie).sid);
    if (!result) return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Please log in to continue.' } });
    req.user = result.user; req.session = result.session; next();
  } catch (error) { next(error); }
}

function asyncRoute(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }

export function createApp(io) {
  const app = express();
  app.locals.dbReady = false;
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'", 'ws:', 'wss:'], formAction: ["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"] } } }));
  app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }));
  const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });
  app.use(express.json({ limit: '32kb' }));
  app.use(express.urlencoded({ extended: false, limit: '32kb' }));
  app.use(express.static(publicDir));
  app.set('view engine', 'ejs'); app.set('views', viewsDir);

  app.get('/', (req, res) => res.render('index'));
  app.get('/chats', (req, res) => res.redirect('/'));
  app.get('/api/health', (req, res) => { const ok = Boolean(req.app.locals.dbReady); res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'degraded', service: 'miniWhatsApp', database: ok ? 'connected' : 'disconnected' }); });

  app.post('/api/auth/register', authLimit, asyncRoute(async (req, res) => { const session = await registerUser(parseBody(registerSchema, req.body), req); res.setHeader('Set-Cookie', sessionCookie(session.token, env.SESSION_TTL_DAYS * 86400)); res.status(201).json({ user: session.user }); }));
  app.post('/api/auth/login', authLimit, asyncRoute(async (req, res) => { const session = await loginUser(parseBody(loginSchema, req.body), req); res.setHeader('Set-Cookie', sessionCookie(session.token, env.SESSION_TTL_DAYS * 86400)); res.json({ user: session.user }); }));
  app.post('/api/auth/logout', asyncRoute(async (req, res) => { await logoutUser(parseCookies(req.headers.cookie).sid); res.setHeader('Set-Cookie', clearSessionCookie()); res.status(204).end(); }));
  app.get('/api/auth/me', requireUser, (req, res) => res.json({ user: publicUser(req.user) }));

  app.get('/api/users', requireUser, asyncRoute(async (req, res) => {
    const search = String(req.query.search || '').trim();
    if (search.length < 2) return res.json({ users: [] });
    const regex = { $regex: search, $options: 'i' };
    const users = await User.find({ _id: { $ne: req.user._id }, $or: [{ username: regex }, { email: regex }, { displayName: regex }] }).select('username email displayName avatarUrl lastSeenAt').limit(20).lean();
    res.json({ users: users.map(publicUser) });
  }));

  app.get('/api/conversations', requireUser, asyncRoute(async (req, res) => res.json({ conversations: await listConversations(req.user._id) })));
  app.post('/api/conversations/direct', requireUser, asyncRoute(async (req, res) => { const input = parseBody(directSchema, req.body); res.status(201).json({ conversation: await directConversation(req.user._id, input.userId) }); }));
  app.get('/api/conversations/:conversationId/messages', requireUser, asyncRoute(async (req, res) => res.json({ messages: await listMessages(req.params.conversationId, req.user._id, req.query.limit) })));
  app.post('/api/conversations/:conversationId/messages', requireUser, asyncRoute(async (req, res) => {
    const result = await sendMessage(req.params.conversationId, req.user._id, parseBody(sendSchema, req.body));
    if (!result.duplicate && io) io.to('conversation:' + req.params.conversationId).emit('message:new', result.message);
    res.status(result.duplicate ? 200 : 201).json(result);
  }));
  app.patch('/api/messages/:messageId', requireUser, asyncRoute(async (req, res) => { const message = await editMessage(req.params.messageId, req.user._id, parseBody(editSchema, req.body).body); if (io) io.to('conversation:' + message.conversationId).emit('message:updated', message); res.json({ message }); }));
  app.delete('/api/messages/:messageId', requireUser, asyncRoute(async (req, res) => { const message = await deleteMessage(req.params.messageId, req.user._id); if (io) io.to('conversation:' + message.conversationId).emit('message:deleted', message); res.json({ message }); }));
  app.post('/api/conversations/:conversationId/read', requireUser, asyncRoute(async (req, res) => { const result = await markRead(req.params.conversationId, req.user._id); if (io) io.to('conversation:' + result.conversationId).emit('message:read', result); res.json(result); }));

  app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error?.code === 11000) return res.status(409).json({ error: { code: 'DUPLICATE_RESOURCE', message: 'A unique value is already in use.' } });
    const status = error.status || 500; console.error(error);
    res.status(status).json({ error: { code: error.code || 'INTERNAL_ERROR', message: status === 500 && env.NODE_ENV === 'production' ? 'Unexpected server error.' : error.message, ...(error.details ? { details: error.details } : {}) } });
  });
  return app;
}

export async function joinConversationForSocket(socket, conversationId) {
  const { getConversationForUser } = await import('./services.js');
  const conversation = await getConversationForUser(conversationId, socket.user._id);
  socket.join('conversation:' + conversation._id);
  return conversation;
}