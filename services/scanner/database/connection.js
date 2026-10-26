import { connectMongo } from '../../../shared/mongo.js';

export const connectDatabase = () => connectMongo('scanner', process.env.SCANNER_DB || 'mexc_scanner');
