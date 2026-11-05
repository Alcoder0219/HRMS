import { test, before, after, beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Every image upload, through the real routes, Multer limits and a local
 * MongoDB, with only Cloudinary's own network calls replaced.
 *
 * What it pins is the lifecycle: where an image goes, what MongoDB keeps, and
 * that a failure at any step neither loses the old image nor leaves a new one
 * behind. Runs against a THROWAWAY local database and refuses anything else.
 */

const TEST_URI = process.env.MONGODB_TEST_URI_IMAGES ?? 'mongodb://127.0.0.1:27017/hrms_cloudinary_test';

if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(TEST_URI)) {
  throw new Error(`Refusing to run destructive tests against a non-local database: ${TEST_URI}`);
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'hrms-images-'));

Object.assign(process.env, {
  NODE_ENV: 'test',
  MONGODB_URI: TEST_URI,
  JWT_ACCESS_SECRET: 'test-access-secret',
  JWT_REFRESH_SECRET: 'test-refresh-secret',
  LOG_TO_FILE: 'false',
  LOG_LEVEL: 'silent',
  ATTACHMENTS_DIR: path.join(scratch, 'attachments'),
  UPLOAD_DIR: path.join(scratch, 'uploads'),
  CLOUDINARY_CLOUD_NAME: 'test-cloud',
  CLOUDINARY_API_KEY: 'test-key',
  CLOUDINARY_API_SECRET: 'test-secret',
});

const mongoose = (await import('mongoose')).default;

let reachable = true;
try {
  await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 2000 });
} catch {
  reachable = false;
}

const { v2: cloudinary } = await import('cloudinary');
const { default: app } = reachable ? await import('../app.js') : { default: null };
const { Candidate, Employee, User } = reachable ? await import('../models/index.js') : {};
const { default: env } = await import('../config/env.js');
const { default: employeeRepository } = await import('../repositories/employee/employee.repository.js');
const { signAccessToken } = await import('../helpers/token.helper.js');
const { hashPassword } = await import('../helpers/password.helper.js');

const BYTES = Buffer.from('not really a jpeg, but the storage stub does not mind');
const PDF = Buffer.from('%PDF-1.4 stub');
const JPEG = 'image/jpeg';

/** Stands in for Cloudinary: what it holds, and what it was asked. */
const storage = { assets: new Map(), uploads: [], destroyed: [], failUpload: null, order: [] };

const realFetch = globalThis.fetch;

let server;
let base;
let token;
let serial = 0;

const authorised = (extra = {}) => ({ headers: { Authorization: `Bearer ${token}` }, ...extra });

const send = async (method, route, field, files) => {
  const form = new FormData();
  files.forEach(({ bytes = BYTES, type = JPEG, name = 'scan.jpg' }) => form.append(field, new Blob([bytes], { type }), name));

  const response = await realFetch(`${base}${route}`, authorised({ method, body: form }));
  return { status: response.status, body: await response.json() };
};

const employee = async () => {
  serial += 1;
  return Employee.create({ employeeCode: `IMG${String(serial).padStart(3, '0')}`, firstName: 'Test', lastName: 'Person', joiningDate: new Date('2025-01-01') });
};

const stored = (person) => Employee.findById(person._id).select('+documents.imageUrl').lean();

const fileCount = (directory) =>
  fs.existsSync(directory) ? fs.readdirSync(directory, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).length : 0;

describe('Cloudinary image storage', { skip: !reachable && 'MongoDB is not reachable on localhost' }, () => {
  before(async () => {
    await mongoose.connection.dropDatabase();

    const { ensureSystemRoles } = await import('../services/admin/role.service.js');
    const { loadRoleCache } = await import('../services/auth/roleCache.service.js');
    await ensureSystemRoles();
    await loadRoleCache();

    const admin = await User.create({
      firstName: 'Super', lastName: 'Admin', email: 'super@images.test', password: await hashPassword('Kilimanjaro!Teal#7429'),
      role: 'SUPER_ADMIN', status: 'ACTIVE', isEmailVerified: true,
    });
    token = signAccessToken({ userId: admin._id, tenantId: null, role: 'SUPER_ADMIN' });

    cloudinary.uploader.upload = async (file, options) => {
      assert.ok(fs.existsSync(file), 'the temporary file is there to upload');
      if (storage.failUpload) throw { error: storage.failUpload };

      const publicId = `Amsons_Hrms/asset${storage.uploads.length + 1}`;
      storage.uploads.push(options);
      storage.assets.set(publicId, fs.readFileSync(file));
      storage.order.push(`upload ${publicId}`);

      return {
        secure_url: `https://res.cloudinary.com/test-cloud/image/authenticated/s--signed--/v1/${publicId}.jpg`,
        public_id: publicId,
        format: 'jpg',
        bytes: fs.statSync(file).size,
      };
    };

    cloudinary.uploader.destroy = async (publicId, options) => {
      assert.equal(options.type, 'authenticated');
      storage.destroyed.push(publicId);
      storage.order.push(`destroy ${publicId}`);
      return { result: storage.assets.delete(publicId) ? 'ok' : 'not found' };
    };

    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith('https://res.cloudinary.com/')) return realFetch(url, options);

      const publicId = String(url).match(/(Amsons_Hrms\/asset\d+)/)?.[1];
      const bytes = storage.assets.get(publicId);
      return bytes ? new Response(bytes, { status: 200 }) : new Response('gone', { status: 404 });
    };

    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}/api/v1`;
  });

  beforeEach(() => {
    storage.uploads.length = 0;
    storage.destroyed.length = 0;
    storage.order.length = 0;
    storage.failUpload = null;
  });

  after(async () => {
    globalThis.fetch = realFetch;
    server?.close();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  test('a Documents tab image goes to Amsons_Hrms; MongoDB keeps only the reference', async () => {
    const person = await employee();
    const { status } = await send('POST', `/employees/${person._id}/attachments/PASSPORT_COPY`, 'files', [{ name: 'passport.jpg' }]);
    assert.equal(status, 201);

    assert.equal(storage.uploads.length, 1);
    assert.equal(storage.uploads[0].folder, 'Amsons_Hrms');
    assert.equal(storage.uploads[0].type, 'authenticated', 'an ID scan must not have a public URL');
    assert.equal(storage.uploads[0].resource_type, 'image');

    const [document] = (await stored(person)).documents;
    assert.match(document.imageUrl, /^https:\/\/res\.cloudinary\.com\//);
    assert.match(document.cloudinaryPublicId, /^Amsons_Hrms\//);
    assert.equal(document.filePath, document.cloudinaryPublicId);
    assert.equal(document.imageFormat, 'jpg');
    assert.equal(document.size, BYTES.length);
    assert.equal(document.title, 'passport.jpg');

    const raw = JSON.stringify(await mongoose.connection.db.collection('employees').findOne({ _id: person._id }));
    assert.ok(!raw.includes(BYTES.toString('base64')) && !raw.includes(BYTES.toString()), 'no image content in MongoDB');

    assert.equal(fileCount(path.join(scratch, 'attachments', person.employeeCode)), 0, 'no local copy remains');
  });

  test('the signed URL is not sent to the browser, and previews still work', async () => {
    const person = await employee();
    await send('POST', `/employees/${person._id}/attachments/TIN_COPY`, 'files', [{}]);

    const profile = await realFetch(`${base}/employees/${person._id}`, authorised());
    const list = await realFetch(`${base}/employees/${person._id}/attachments`, authorised());
    const [profileText, listText] = [await profile.text(), await list.text()];

    assert.equal(profile.status, 200);
    assert.ok(!profileText.includes('s--signed--'), 'employee response');
    assert.ok(!listText.includes('s--signed--'), 'documents response');

    const documentId = (await stored(person)).documents[0]._id;
    const preview = await realFetch(`${base}/employees/${person._id}/attachments/${documentId}/file?disposition=inline`, authorised());

    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get('content-type'), JPEG);
    assert.match(preview.headers.get('content-disposition'), /^inline/);
    assert.equal(preview.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(Buffer.from(await preview.arrayBuffer()), BYTES);

    const anonymous = await realFetch(`${base}/employees/${person._id}/attachments/${documentId}/file`);
    assert.equal(anonymous.status, 401, 'still behind a session');
  });

  test('a single-file section: the old image goes only after the new one is recorded', async () => {
    const person = await employee();
    await send('POST', `/employees/${person._id}/attachments/NHIF_CARD_COPY`, 'files', [{}]);
    const old = (await stored(person)).documents[0];

    storage.order.length = 0;
    await send('POST', `/employees/${person._id}/attachments/NHIF_CARD_COPY`, 'files', [{ name: 'new.jpg' }]);

    const { documents } = await stored(person);
    assert.equal(documents.length, 1);
    assert.equal(documents[0].title, 'new.jpg');
    assert.deepEqual(storage.destroyed, [old.cloudinaryPublicId]);
    assert.ok(storage.order.findIndex((entry) => entry.startsWith('upload')) < storage.order.findIndex((entry) => entry.startsWith('destroy')));
  });

  test('replacing a document swaps the reference and removes the old image', async () => {
    const person = await employee();
    await send('POST', `/employees/${person._id}/attachments/EDUCATION`, 'files', [{ name: 'a.jpg' }, { name: 'b.jpg' }]);
    const [first] = (await stored(person)).documents;

    const { status } = await send('PUT', `/employees/${person._id}/attachments/${first._id}/replace/EDUCATION`, 'file', [{ name: 'a2.jpg' }]);
    assert.equal(status, 200);

    const { documents } = await stored(person);
    assert.deepEqual(documents.map((document) => document.title).sort(), ['a2.jpg', 'b.jpg']);
    assert.deepEqual(storage.destroyed, [first.cloudinaryPublicId]);
  });

  test('a failed upload changes nothing: no record, no temporary file, old image kept', async () => {
    const person = await employee();
    await send('POST', `/employees/${person._id}/attachments/BIRTH_CERTIFICATE`, 'files', [{}]);
    const before = (await stored(person)).documents;

    storage.failUpload = { message: 'timeout', http_code: 500 };
    const { status, body } = await send('POST', `/employees/${person._id}/attachments/BIRTH_CERTIFICATE`, 'files', [{}]);

    assert.equal(status, 502);
    assert.equal(body.code, 'IMAGE_STORAGE_FAILED');
    assert.deepEqual((await stored(person)).documents.map((document) => document.cloudinaryPublicId), before.map((document) => document.cloudinaryPublicId));
    assert.deepEqual(storage.destroyed, []);
    assert.equal(fileCount(path.join(scratch, 'attachments', person.employeeCode)), 0);
  });

  test('a failed database write removes the new image and keeps the old one', async () => {
    const person = await employee();
    await send('POST', `/employees/${person._id}/attachments/WORK_PERMIT`, 'files', [{}]);
    const old = (await stored(person)).documents[0];

    const real = employeeRepository.updateById;
    employeeRepository.updateById = async () => {
      throw new Error('database unavailable');
    };

    try {
      const { status } = await send('POST', `/employees/${person._id}/attachments/WORK_PERMIT`, 'files', [{}]);
      assert.equal(status, 500);
    } finally {
      employeeRepository.updateById = real;
    }

    const { documents } = await stored(person);
    assert.equal(documents.length, 1);
    assert.equal(documents[0].cloudinaryPublicId, old.cloudinaryPublicId);
    assert.ok(storage.assets.has(old.cloudinaryPublicId), 'the old image is safe');
    assert.equal(storage.destroyed.length, 1, 'the new image is cleaned up');
    assert.notEqual(storage.destroyed[0], old.cloudinaryPublicId);
  });

  test('a file that is not really an image is refused with a reason', async () => {
    const person = await employee();
    storage.failUpload = { message: 'Invalid image file', http_code: 400 };

    const { status, body } = await send('POST', `/employees/${person._id}/attachments/OTHER`, 'files', [{ name: 'fake.jpg' }]);

    assert.equal(status, 400);
    assert.match(body.message, /fake\.jpg is not a valid/);
    assert.equal((await stored(person)).documents.length, 0);
  });

  test('type and size limits still apply before anything is sent to storage', async () => {
    const person = await employee();

    const type = await send('POST', `/employees/${person._id}/attachments/OTHER`, 'files', [{ type: 'application/x-msdownload', name: 'run.exe' }]);
    assert.equal(type.status, 400);

    const big = await send('POST', `/employees/${person._id}/attachments/OTHER`, 'files', [{ bytes: Buffer.alloc(env.attachments.maxImageBytes + 1) }]);
    assert.equal(big.status, 400);
    assert.match(big.body.message, /larger than/);

    assert.equal(storage.uploads.length, 0);
  });

  test('without credentials an image is refused, never kept on disk', async () => {
    const person = await employee();
    const saved = env.cloudinary.apiSecret;
    env.cloudinary.apiSecret = '';

    try {
      const { status, body } = await send('POST', `/employees/${person._id}/attachments/OTHER`, 'files', [{}]);
      assert.equal(status, 503);
      assert.equal(body.code, 'IMAGE_STORAGE_NOT_CONFIGURED');
    } finally {
      env.cloudinary.apiSecret = saved;
    }

    assert.equal(fileCount(path.join(scratch, 'attachments', person.employeeCode)), 0);
    assert.equal((await stored(person)).documents.length, 0);
  });

  test('a PDF is not an image and stays where it was', async () => {
    const person = await employee();
    const { status } = await send('POST', `/employees/${person._id}/attachments/OTHER`, 'files', [{ bytes: PDF, type: 'application/pdf', name: 'letter.pdf' }]);

    assert.equal(status, 201);
    assert.equal(storage.uploads.length, 0);

    const [document] = (await stored(person)).documents;
    assert.equal(document.cloudinaryPublicId, null);
    assert.match(document.filePath, /^attachments\//);

    const download = await realFetch(`${base}/employees/${person._id}/attachments/${document._id}/file`, authorised());
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), PDF);
  });

  test('deleting a document removes its image', async () => {
    const person = await employee();
    await send('POST', `/employees/${person._id}/attachments/OTHER`, 'files', [{}]);
    const [document] = (await stored(person)).documents;

    const response = await realFetch(`${base}/employees/${person._id}/attachments/${document._id}`, authorised({ method: 'DELETE' }));

    assert.equal(response.status, 200);
    assert.deepEqual(storage.destroyed, [document.cloudinaryPublicId]);
    assert.equal((await stored(person)).documents.length, 0);
  });

  test('the employee photo route stores a reference the avatar can use', async () => {
    const person = await employee();

    const { status, body } = await send('POST', `/employees/${person._id}/photo`, 'photo', [{ name: 'me.jpg' }]);
    assert.equal(status < 300, true, JSON.stringify(body));
    assert.equal(storage.uploads[0].folder, 'Amsons_Hrms');

    const first = (await stored(person)).photo;
    assert.match(first.filePath, /^https:\/\/res\.cloudinary\.com\//, 'the avatar renders this directly');
    assert.match(first.cloudinaryPublicId, /^Amsons_Hrms\//);

    await send('POST', `/employees/${person._id}/photo`, 'photo', [{ name: 'me2.jpg' }]);
    assert.deepEqual(storage.destroyed, [first.cloudinaryPublicId], 'the old photo goes after the new one is saved');
  });

  test('the older documents route stores images and removes them on delete', async () => {
    const person = await employee();

    const { status } = await send('POST', `/employees/${person._id}/documents`, 'documents', [{ name: 'old.jpg' }]);
    assert.equal(status, 201);

    const [document] = (await stored(person)).documents;
    assert.match(document.cloudinaryPublicId, /^Amsons_Hrms\//);

    await realFetch(`${base}/employees/${person._id}/documents/${document._id}`, authorised({ method: 'DELETE' }));
    assert.deepEqual(storage.destroyed, [document.cloudinaryPublicId]);
  });

  test('a scanned resume goes to Cloudinary; a PDF resume does not', async () => {
    const candidate = await Candidate.create({ tenantId: null, firstName: 'Cand', lastName: 'Idate', email: `c${Date.now()}@images.test`, jobOpeningId: new mongoose.Types.ObjectId() });

    const scan = await send('POST', `/recruitment/candidates/${candidate._id}/resume`, 'resume', [{ name: 'cv.jpg' }]);
    assert.ok(scan.status < 300, JSON.stringify(scan.body));

    const first = (await Candidate.findById(candidate._id).lean()).resume;
    assert.match(first.filePath, /^https:\/\/res\.cloudinary\.com\//, 'the screen links to this directly');

    await send('POST', `/recruitment/candidates/${candidate._id}/resume`, 'resume', [{ bytes: PDF, type: 'application/pdf', name: 'cv.pdf' }]);

    const second = (await Candidate.findById(candidate._id).lean()).resume;
    assert.match(second.filePath, /^\/uploads\/documents\//);
    assert.deepEqual(storage.destroyed, [first.cloudinaryPublicId]);
  });

  test('a refused upload for an unknown record leaves nothing in storage', async () => {
    const missing = new mongoose.Types.ObjectId();
    const { status } = await send('POST', `/employees/${missing}/photo`, 'photo', [{}]);

    assert.equal(status, 404);
    assert.equal(storage.uploads.length, storage.destroyed.length, 'uploaded and cleaned up');
  });

  test('a soft delete keeps the images, so a restore finds them; a purge removes them', async () => {
    const person = await employee();
    await send('POST', `/employees/${person._id}/attachments/OTHER`, 'files', [{}]);
    const [document] = (await stored(person)).documents;

    const remove = (body) =>
      realFetch(`${base}/employees/${person._id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

    assert.equal((await remove({ reason: 'Left the company' })).status, 200);
    assert.deepEqual(storage.destroyed, []);
    assert.ok(storage.assets.has(document.cloudinaryPublicId));

    const another = await employee();
    await send('POST', `/employees/${another._id}/attachments/OTHER`, 'files', [{}]);
    const [image] = (await stored(another)).documents;
    const purge = await realFetch(`${base}/employees/${another._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Left the company', purgeAttachments: true }),
    });

    assert.equal(purge.status, 200);
    assert.deepEqual(storage.destroyed, [image.cloudinaryPublicId]);
  });

  test('an existing local document still downloads', async () => {
    const person = await employee();
    const folder = path.join(process.env.ATTACHMENTS_DIR, person.employeeCode, 'Other');
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'legacy.jpg'), BYTES);

    await Employee.updateOne({ _id: person._id }, {
      $push: { documents: { type: 'OTHER', title: 'legacy.jpg', fileName: 'legacy.jpg', filePath: `attachments/${person.employeeCode}/Other/legacy.jpg`, mimeType: JPEG, size: BYTES.length } },
    });

    const [document] = (await stored(person)).documents;
    const download = await realFetch(`${base}/employees/${person._id}/attachments/${document._id}/file`, authorised());

    assert.equal(download.status, 200);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), BYTES);
  });
});
