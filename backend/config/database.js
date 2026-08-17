import mongoose from 'mongoose';
import env from './env.js';
import logger from './logger.js';
// Side-effect import: registers every schema before any query or populate runs.
import '../models/index.js';

// Reject writes that reference paths absent from the schema instead of
// silently persisting them -- essential when tenant data is user-driven.
mongoose.set('strictQuery', true);
if (!env.isProduction) mongoose.set('debug', false);

let connection = null;

export const connectDatabase = async () => {
  if (connection) return connection;

  mongoose.connection.on('connected', () => logger.info('MongoDB connected'));
  mongoose.connection.on('error', (error) => logger.error('MongoDB error', error));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));

  connection = await mongoose.connect(env.mongoUri, {
    // Fail fast on boot rather than queueing requests against a dead cluster.
    serverSelectionTimeoutMS: 10_000,
    socketTimeoutMS: 45_000,
    maxPoolSize: 20,
    minPoolSize: 2,
    autoIndex: !env.isProduction,
  });

  return connection;
};

export const disconnectDatabase = async () => {
  if (!connection) return;
  await mongoose.connection.close(false);
  connection = null;
  logger.info('MongoDB connection closed');
};

export default connectDatabase;
