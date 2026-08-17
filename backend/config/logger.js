import fs from 'node:fs';
import winston from 'winston';
import 'winston-daily-rotate-file';
import env from './env.js';

if (env.log.toFile) fs.mkdirSync(env.log.dir, { recursive: true });

const { combine, timestamp, printf, colorize, errors, json, splat } = winston.format;

/**
 * Cloud Logging reads structured stdout, but keys off `severity` -- winston's
 * own `level` field means nothing to it, so every line would land as "Default"
 * and no filter by severity would work. Mapping the two is the whole
 * difference between logs you can search and a wall of undifferentiated text.
 */
const CLOUD_SEVERITY = {
  error: 'ERROR',
  warn: 'WARNING',
  info: 'INFO',
  http: 'INFO',
  verbose: 'DEBUG',
  debug: 'DEBUG',
  silly: 'DEBUG',
};

const cloudSeverity = winston.format((info) => {
  info.severity = CLOUD_SEVERITY[info.level] ?? 'DEFAULT';
  return info;
});

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

const fileTransports = env.log.toFile ? [rotate('application'), rotate('error', 'error')] : [];

const logger = winston.createLogger({
  level: env.log.level,
  defaultMeta: { service: 'hrms-api', env: env.nodeEnv },
  // `errors({ stack: true })` is what turns a thrown Error into a logged stack
  // trace instead of the useless string "[object Object]".
  format: combine(errors({ stack: true }), splat(), timestamp(), json()),
  transports: fileTransports,
  ...(env.log.toFile
    ? { exceptionHandlers: [rotate('exceptions')], rejectionHandlers: [rotate('rejections')] }
    : {}),
  exitOnError: false,
});

/**
 * A console transport in EVERY environment, production included.
 *
 * It used to be development-only, which is correct on a host where the rotated
 * files are the log. In a container it is the opposite: stdout is the only
 * thing the platform collects, so production was writing its entire audit
 * trail to a disk that is thrown away when the instance stops. Development
 * keeps the readable coloured line; production emits JSON, which Cloud Logging
 * parses into searchable fields rather than storing as one opaque string.
 */
logger.add(
  new winston.transports.Console({
    format: env.isProduction
      ? combine(cloudSeverity(), json())
      : combine(colorize(), timestamp({ format: 'HH:mm:ss' }), consoleFormat),
  }),
);

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
