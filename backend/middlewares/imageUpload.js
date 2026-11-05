import fsp from 'node:fs/promises';

import { discardUploads, isImage, uploadImage } from '../services/storage/imageStorage.service.js';

/**
 * Moves the images of an upload into image storage.
 *
 * Runs after Multer and after the route's size and type checks, so every limit
 * still applies, and before the controller, so a service only ever sees a file
 * that has been stored: an image carries `file.cloudinary`, and its temporary
 * copy is gone. Anything that is not an image is left exactly where Multer put
 * it.
 *
 * All or nothing: if one image in a batch fails, the batch goes, for the same
 * reason `enforcePerTypeLimits` does. A partial upload that reports an error but
 * keeps half the files is worse than one that keeps none.
 */
export const storeImages = async (req, _res, next) => {
  const files = req.files ?? (req.file ? [req.file] : []);
  const images = files.filter((file) => isImage(file.mimetype));

  if (!images.length) return next();

  try {
    for (const file of images) {
      // One at a time: a batch is at most ten, and stopping at the first failure
      // means nothing further is uploaded only to be deleted.
      // eslint-disable-next-line no-await-in-loop
      file.cloudinary = await uploadImage(file.path, file.originalname);
    }

    await Promise.all(images.map((file) => fsp.rm(file.path, { force: true })));
    return next();
  } catch (error) {
    await discardUploads(files);
    return next(error);
  }
};

export default storeImages;
