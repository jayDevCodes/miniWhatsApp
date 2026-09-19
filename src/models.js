import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true, trim: true, lowercase: true, minlength: 3, maxlength: 32 },
  email: { type: String, required: true, unique: true, trim: true, lowercase: true, maxlength: 254 },
  passwordHash: { type: String, required: true, select: false },
  displayName: { type: String, trim: true, maxlength: 80 },
  avatarUrl: { type: String, trim: true, maxlength: 500 },
  lastSeenAt: { type: Date, default: null },
}, { timestamps: true });

const sessionSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true, unique: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  expiresAt: { type: Date, required: true, index: true },
  userAgent: { type: String, maxlength: 500 },
  ip: { type: String, maxlength: 64 },
}, { timestamps: true });

sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const conversationSchema = new mongoose.Schema({
  type: { type: String, enum: ['direct', 'group'], default: 'direct', required: true },
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
  lastMessageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
  lastMessagePreview: { type: String, maxlength: 160, default: '' },
}, { timestamps: true });

conversationSchema.index({ participants: 1, updatedAt: -1 });

const messageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  body: { type: String, required: true, trim: true, minlength: 1, maxlength: 4000 },
  clientMessageId: { type: String, required: true, maxlength: 100 },
  editedAt: { type: Date, default: null },
  deletedAt: { type: Date, default: null },
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true });

messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ conversationId: 1, clientMessageId: 1 }, { unique: true });

export const User = mongoose.model('User', userSchema);
export const Session = mongoose.model('Session', sessionSchema);
export const Conversation = mongoose.model('Conversation', conversationSchema);
export const Message = mongoose.model('Message', messageSchema);