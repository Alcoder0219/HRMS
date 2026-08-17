import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';

import env from './config/env.js';
import corsOptions from './config/cors.js';
import requestId from './middlewares/requestId.js';
import httpLogger from './middlewares/httpLogger.js';
import { apiLimiter } from './middlewares/rateLimiter.js';
import notFound from './middlewares/notFound.js';
import errorHandler from './middlewares/errorHandler.js';
import routes from './routes/index.js';

const app = express();

// Behind a load balancer or reverse proxy, this is what makes req.ip and the
// rate limiter see the real client address instead of the proxy's. The hop
// count is configurable because it depends on the deployment -- see
// TRUST_PROXY in config/env.js.
app.set('trust proxy', env.trustProxy);
app.disable('x-powered-by');

/* ---------------------------------------------------------------- security */
app.use(
  helmet({
    // The API serves JSON and uploaded files, never HTML, so CSP has nothing
    // to protect here; it belongs on the frontend host.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);
app.use(cors(corsOptions));

/* ------------------------------------------------------------ observability */
app.use(requestId);
app.use(httpLogger);

/* ------------------------------------------------------------ body parsing */
// Bounded payloads: an unbounded JSON body is a trivial memory-exhaustion
// vector. File uploads bypass this entirely and go through Multer.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());
app.use(compression());

/* ----------------------------------------------------------------- uploads */
// Local-disk delivery for development. In production this is fronted by object
// storage + CDN, and the mount point stays the same so client URLs don't move.
app.use('/uploads', express.static(env.upload.dir, { maxAge: '7d', fallthrough: true }));

/* ------------------------------------------------------------ health check */
// Kept outside the API prefix and the rate limiter so orchestrators can probe
// it freely.
app.get('/health', (_req, res) => {
  const dbStates = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  res.status(200).json({
    success: true,
    status: 'ok',
    environment: env.nodeEnv,
    uptime: Math.round(process.uptime()),
    database: dbStates[mongoose.connection.readyState] ?? 'unknown',
    timestamp: new Date().toISOString(),
  });
});

/* --------------------------------------------------------------------- api */
app.use(env.apiPrefix, apiLimiter, routes);

/* ------------------------------------------------------- terminal handlers */
// Order matters: 404 must come after every route, and the error handler last.
app.use(notFound);
app.use(errorHandler);

export default app;
