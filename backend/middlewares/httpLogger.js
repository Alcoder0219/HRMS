import morgan from 'morgan';
import env from '../config/env.js';
import { httpLogStream } from '../config/logger.js';

morgan.token('id', (req) => req.id);
morgan.token('tenant', (req) => req.tenantId || '-');

const format = env.isProduction
  ? ':id :remote-addr :tenant :method :url :status :res[content-length] - :response-time ms'
  : ':id :method :url :status - :response-time ms';

/**
 * Morgan feeds winston rather than stdout, so HTTP access lines land in the
 * same rotated files as application logs and stay correlated by request id.
 */
const httpLogger = morgan(format, {
  stream: httpLogStream,
  // Health checks would otherwise dominate the log volume.
  skip: (req) => req.originalUrl === '/health',
});

export default httpLogger;
