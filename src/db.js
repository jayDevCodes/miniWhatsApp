import mongoose from 'mongoose';
import { env } from './config.js';

export async function connectDatabase() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}