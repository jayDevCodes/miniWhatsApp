import mongoose from 'mongoose';
import { Conversation, Message, User, Session } from './models.js';
import { createSession, hashPassword, verifyPassword } from './security.js';

const publicUser = (user) => ({
  id: String(user._id),
  username: user.username,
  email: user.email,
  displayName: user.displayName || user.username,
  avatarUrl: user.avatarUrl || null,
  lastSeenAt: user.lastSeenAt || null,
});

const publicMessage = (message) => ({
  id: String(message._id),
  conversationId: String(message.conversationId),
  senderId: String(message.senderId),
  body: message.deletedAt ? '' : message.body,
  editedAt: message.editedAt || null,
  deletedAt: message.deletedAt || null,
  readBy: (message.readBy || []).map(String),
  clientMessageId: message.clientMessageId,
  createdAt: message.createdAt,
  updatedAt: message.updatedAt,
});

export const toPublicUser = publicUser;

export function validId(value) {
  return mongoose.isValidObjectId(value);
}

export async function registerUser(data, req) {
  const email = data.email.trim().toLowerCase();
  const username = data.username.trim().toLowerCase();
  const exists = await User.findOne({ $or: [{ email }, { username }] }).lean();
  if (exists) throw Object.assign(new Error('Account already exists.'), { status: 409, code: 'ACCOUNT_EXISTS' });

  const user = await User.create({
    email,
    username,
    displayName: data.displayName?.trim() || username,
    passwordHash: await hashPassword(data.password),
  });
  return { user: publicUser(user), token: await createSession(user._id, req) };
}

export async function loginUser(data, req) {
  const user = await User.findOne({ email: data.email.trim().toLowerCase() }).select('+passwordHash');
  if (!user || !(await verifyPassword(data.password, user.passwordHash))) {
    throw Object.assign(new Error('Email or password is incorrect.'), { status: 401, code: 'INVALID_CREDENTIALS' });
  }
  user.lastSeenAt = new Date();
  await user.save();
  return { user: publicUser(user), token: await createSession(user._id, req) };
}

export async function logoutUser(token) {
  if (token) await Session.deleteOne({ tokenHash: (await import('node:crypto')).createHash('sha256').update(token).digest('hex') });
}

export async function getConversationForUser(conversationId, userId) {
  if (!validId(conversationId)) throw Object.assign(new Error('Invalid conversation id.'), { status: 400, code: 'INVALID_ID' });
  const conversation = await Conversation.findOne({ _id: conversationId, participants: userId })
    .populate('participants', 'username email displayName avatarUrl lastSeenAt');
  if (!conversation) throw Object.assign(new Error('Conversation not found.'), { status: 404, code: 'CONVERSATION_NOT_FOUND' });
  return conversation;
}

export async function listConversations(userId) {
  const rows = await Conversation.find({ participants: userId })
    .populate('participants', 'username email displayName avatarUrl lastSeenAt')
    .sort({ updatedAt: -1 })
    .lean();
  return rows.map((c) => ({
    id: String(c._id),
    type: c.type,
    participants: c.participants.map(publicUser),
    lastMessageId: c.lastMessageId ? String(c.lastMessageId) : null,
    lastMessagePreview: c.lastMessagePreview || '',
    updatedAt: c.updatedAt,
  }));
}

export async function directConversation(userId, otherUserId) {
  if (!validId(otherUserId)) throw Object.assign(new Error('Invalid user id.'), { status: 400, code: 'INVALID_ID' });
  if (String(userId) === String(otherUserId)) throw Object.assign(new Error('You cannot chat with yourself.'), { status: 400, code: 'SELF_CONVERSATION' });
  if (!(await User.exists({ _id: otherUserId }))) throw Object.assign(new Error('User not found.'), { status: 404, code: 'USER_NOT_FOUND' });

  let conversation = await Conversation.findOne({
    type: 'direct',
    participants: { $all: [userId, otherUserId], $size: 2 },
  });
  if (!conversation) {
    conversation = await Conversation.create({ type: 'direct', participants: [userId, otherUserId] });
  }
  await conversation.populate('participants', 'username email displayName avatarUrl lastSeenAt');
  return {
    id: String(conversation._id),
    type: conversation.type,
    participants: conversation.participants.map(publicUser),
    lastMessageId: conversation.lastMessageId ? String(conversation.lastMessageId) : null,
    lastMessagePreview: conversation.lastMessagePreview || '',
    updatedAt: conversation.updatedAt,
  };
}

export async function listMessages(conversationId, userId, limit = 100) {
  const conversation = await getConversationForUser(conversationId, userId);
  const rows = await Message.find({ conversationId: conversation._id })
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 50, 100))
    .lean();
  return rows.reverse().map(publicMessage);
}

export async function sendMessage(conversationId, senderId, data) {
  const conversation = await getConversationForUser(conversationId, senderId);
  const existing = await Message.findOne({ conversationId: conversation._id, clientMessageId: data.clientMessageId }).lean();
  if (existing) return { message: publicMessage(existing), duplicate: true };

  const message = await Message.create({
    conversationId: conversation._id,
    senderId,
    body: data.body.trim(),
    clientMessageId: data.clientMessageId,
    readBy: [senderId],
  });

  await Conversation.updateOne({ _id: conversation._id }, {
    $set: { lastMessageId: message._id, lastMessagePreview: message.body.slice(0, 160) },
  });

  return { message: publicMessage(message), duplicate: false };
}

export async function editMessage(messageId, userId, body) {
  if (!validId(messageId)) throw Object.assign(new Error('Invalid message id.'), { status: 400, code: 'INVALID_ID' });
  const message = await Message.findOne({ _id: messageId, senderId: userId });
  if (!message) throw Object.assign(new Error('Message not found.'), { status: 404, code: 'MESSAGE_NOT_FOUND' });
  if (message.deletedAt) throw Object.assign(new Error('Deleted messages cannot be edited.'), { status: 409, code: 'MESSAGE_DELETED' });

  message.body = body.trim();
  message.editedAt = new Date();
  await message.save();
  await Conversation.updateOne({ _id: message.conversationId, lastMessageId: message._id }, { $set: { lastMessagePreview: message.body.slice(0, 160) } });
  return publicMessage(message);
}

export async function deleteMessage(messageId, userId) {
  if (!validId(messageId)) throw Object.assign(new Error('Invalid message id.'), { status: 400, code: 'INVALID_ID' });
  const message = await Message.findOne({ _id: messageId, senderId: userId });
  if (!message) throw Object.assign(new Error('Message not found.'), { status: 404, code: 'MESSAGE_NOT_FOUND' });

  message.deletedAt = new Date();
  await message.save();
  await Conversation.updateOne({ _id: message.conversationId, lastMessageId: message._id }, { $set: { lastMessagePreview: 'Message deleted' } });
  return publicMessage(message);
}

export async function markRead(conversationId, userId) {
  const conversation = await getConversationForUser(conversationId, userId);
  await Message.updateMany({ conversationId: conversation._id, senderId: { $ne: userId }, readBy: { $ne: userId } }, { $addToSet: { readBy: userId } });
}