import fs from 'node:fs';
import winston from 'winston';
import 'winston-daily-rotate-file';
import env from './env.js';

fs.mkdirSync(env.log.dir, { recursive: true });

const { combine, timestamp, printf, colorize, errors, json, splat } = winston.format;

/** Human-readable single line, used on the console during development. */
const consoleFormat = printf(({ level, message, timestamp: ts, stack, ...meta }) => {
  const context = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${ts} [${level}] ${stack || message}${context}`;
});

const rotate = (filename, level) =>
  new winston.transports.DailyRotateFile({
    level,
    dirname: env.log.dir,
    filename: `${filename}-%DATE%.log`,
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    // Payroll and PII activity has to stay auditable well beyond a debug
    // session, so application logs are kept for a full quarter.
    maxFiles: '90d',
  });

const logger = winston.createLogger({
  level: env.log.level,
  defaultMeta: { service: 'hrms-api', env: env.nodeEnv },
  // `errors({ stack: true })` is what turns a thrown Error into a logged stack
  // trace instead of the useless string "[object Object]".
  format: combine(errors({ stack: true }), splat(), timestamp(), json()),
  transports: [rotate('application'), rotate('error', 'error')],
  exceptionHandlers: [rotate('exceptions')],
  rejectionHandlers: [rotate('rejections')],
  exitOnError: false,
});

if (!env.isProduction) {
  logger.add(
    new winston.transports.Console({
      format: combine(
        colorize(),
        timestamp({ format: 'HH:mm:ss' }),
        consoleFormat,
      ),
    }),
  );
}

/**
 * Morgan writes plain strings; this adapts them onto the winston pipeline.
 * Logged at `info` rather than winston's `http` level on purpose: `http` sits
 * below `info` in npm levels, so access lines would be silently dropped in
 * production, where LOG_LEVEL defaults to `info`.
 */
export const httpLogStream = {
  write: (message) => logger.info(message.trim(), { type: 'access' }),
};

export default logger;
