import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { env } from './config.js';
import { Session, User } from './models.js';

const scryptAsync = (password, salt) => new Promise((resolve, reject) => {
  scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, key) => {
    if (error) reject(error);
    else resolve(key);
  });
});

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scryptAsync(password, salt);
  return 'scrypt$' + salt + '$' + key.toString('hex');
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const expected = Buffer.from(parts[2], 'hex');
  const actual = await scryptAsync(password, parts[1]);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createSessionToken() {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function parseCookies(header = '') {
  const output = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    output[key] = decodeURIComponent(value);
  }
  return output;
}

export function sessionCookie(token, maxAge) {
  let value = 'sid=' + encodeURIComponent(token) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge;
  if (env.NODE_ENV === 'production') value += '; Secure';
  return value;
}

export function clearSessionCookie() {
  let value = 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
  if (env.NODE_ENV === 'production') value += '; Secure';
  return value;
}

export async function createSession(userId, req) {
  const token = createSessionToken();
  await Session.create({
    tokenHash: hashSessionToken(token),
    userId,
    expiresAt: new Date(Date.now() + env.SESSION_TTL_DAYS * 86400000),
    userAgent: (req.get('user-agent') || '').slice(0, 500),
    ip: req.ip,
  });
  return token;
}

export async function userFromToken(token) {
  if (!token) return null;
  const session = await Session.findOne({ tokenHash: hashSessionToken(token) });
  if (!session || session.expiresAt <= new Date()) return null;
  const user = await User.findById(session.userId);
  return user ? { user, session } : null;
}