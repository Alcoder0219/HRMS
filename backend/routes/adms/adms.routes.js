import express, { Router } from 'express';

import env from '../../config/env.js';
import controller from '../../controllers/biometric/adms.controller.js';
import { admsEnabled, admsNetworkGuard, admsRateLimiter, requireSerial } from '../../middlewares/admsGuard.js';

const router = Router();

/**
 * The ZKTeco ADMS receiver.
 *
 * Mounted at `/iclock` at the ROOT, outside the API prefix and outside the JWT
 * middleware: the path is fixed by the terminal's firmware, which can be given
 * a host and a port and nothing else, and the terminal has no way to log in.
 * Its protection is the guard chain below instead -- see middlewares/admsGuard.js.
 *
 * The body is read as text whatever the Content-Type says. Terminals variously
 * send text/plain, application/x-www-form-urlencoded and nothing at all for the
 * same tab-separated payload, and the JSON and urlencoded parsers mounted for
 * the API would otherwise mangle or swallow it.
 */

router.use(admsEnabled, admsNetworkGuard, admsRateLimiter, requireSerial);
router.use(express.text({ type: () => true, limit: env.adms.maxBodyBytes, defaultCharset: 'utf-8' }));

router.get('/cdata', controller.cdataGet);
router.post('/cdata', controller.cdataPost);

router.get('/getrequest', controller.getRequest);
// A few firmwares poll with POST; it means the same thing.
router.post('/getrequest', controller.getRequest);

router.post('/devicecmd', controller.deviceCmd);

// Newer push firmware probes these. Acknowledged so it carries on with cdata.
router.all('/registry', controller.ack);
router.all('/ping', controller.ack);

export default router;
