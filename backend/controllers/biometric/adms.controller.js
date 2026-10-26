import logger from '../../config/logger.js';
import receiver, { AdmsRejection } from '../../services/biometric/admsReceiver.service.js';

/**
 * HTTP adapter for the ADMS receiver.
 *
 * Not `asyncHandler` and not `ApiResponse`: a terminal reads plain text and
 * nothing else, so an error must become a short text reply with the right
 * status rather than the API's JSON envelope -- which the device would try to
 * parse as options and fail on.
 *
 * The status code is what drives the device's retry. A 200 tells it the upload
 * was taken and it moves on; a 5xx makes it keep the batch and try again after
 * ErrorDelay, which is exactly right when the database blinked.
 */

const text = (res, status, body) => res.status(status).type('text/plain').send(body);

const handle = (work) => async (req, res) => {
  const input = {
    query: req.query ?? {},
    body: typeof req.body === 'string' ? req.body : '',
    ip: req.admsClientIp ?? null,
  };

  try {
    const context = await receiver.resolveDevice(req.admsSerial, input.ip);
    return text(res, 200, await work(context, input, req));
  } catch (error) {
    if (error instanceof AdmsRejection) return text(res, error.status, error.reply);

    // Logged without the body: it is unvalidated device output and may carry
    // whatever the terminal holds. The serial and table are enough to find it.
    logger.error('ADMS request failed', {
      serialNumber: req.admsSerial,
      path: req.path,
      table: req.query?.table ?? null,
      error: error.message,
    });
    return text(res, 500, 'ERROR');
  }
};

/** `GET cdata` with `options` is the handshake; without, a bare keep-alive. */
export const cdataGet = handle((context, input) =>
  input.query.options !== undefined ? receiver.handshake(context, input) : receiver.receiveOther(context, input),
);

export const cdataPost = handle((context, input) => {
  const table = String(input.query.table ?? '').toUpperCase();

  if (table === 'ATTLOG') return receiver.receiveAttlog(context, input);
  if (table === 'OPERLOG' || table === 'USERINFO' || table === 'USER') return receiver.receiveOperlog(context, input);
  return receiver.receiveOther(context, input);
});

export const getRequest = handle((context, input) => receiver.poll(context, input));

export const deviceCmd = handle((context, input) => receiver.receiveCommandResults(context, input));

export const ack = handle((context, input) => receiver.receiveOther(context, input));

export default { cdataGet, cdataPost, getRequest, deviceCmd, ack };
