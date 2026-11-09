import mongoose from 'mongoose';
import { env } from './env.js';
import { MongoHistoryStore } from '../services/history.mongo.js';
import { attachPersistentStore } from '../services/history.service.js';

export async function connectDatabase() {
  if (!env.mongoUri) {
    console.warn('MongoDB URI is not configured; history is kept in a bounded in-memory buffer only.');
    return false;
  }
  try {
    await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 5000 });
    attachPersistentStore(new MongoHistoryStore({ maxDocs: env.historyMaxDocs }), () => mongoose.connection.readyState === 1);
    console.log('MongoDB connected');
    return true;
  } catch (error) {
    console.error('MongoDB connection failed (falling back to in-memory history):', error.message);
    return false;
  }
}
