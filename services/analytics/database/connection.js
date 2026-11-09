import { connectMongo } from '../../../shared/mongo.js';

export const connectDatabase = () => connectMongo('analytics', process.env.ANALYTICS_DB || 'mexc_analytics');
