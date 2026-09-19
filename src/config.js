export const env = Object.freeze({
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT || 8080),
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/miniwhatsapp',
  SESSION_TTL_DAYS: Number(process.env.SESSION_TTL_DAYS || 30),
});