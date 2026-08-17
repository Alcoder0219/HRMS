import { randomUUID } from 'node:crypto';

/**
 * Stamps every request with a correlation id, echoed back in `X-Request-Id`.
 * A support ticket quoting that id maps to exact lines in the log files.
 */
const requestId = (req, res, next) => {
  req.id = req.get('X-Request-Id') || randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
};

export default requestId;
