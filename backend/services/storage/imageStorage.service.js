import fsp from 'node:fs/promises';
import { Readable } from 'node:stream';

import { v2 as cloudinary } from 'cloudinary';

import env from '../../config/env.js';
import logger from '../../config/logger.js';
import ApiError from '../../utils/ApiError.js';

/**
 * The one place an image is stored, read or deleted.
 *
 * Every image in the product lives in the Cloudinary folder below; MongoDB holds
 * only the reference. Nothing else in the code talks to Cloudinary, so the
 * storage rules are decided here and every module gets them.
 *
 * `authenticated` rather than the default `upload` delivery type. Many of these
 * images are scans of national IDs and passports, and a public URL would make
 * them readable by anyone who came across the link, without a session or an
 * audit entry. An authenticated asset can only be delivered through a signed
 * URL, and the secure URL Cloudinary returns carries that signature, so it is
 * treated as a secret: documents are streamed through the API instead of
 * sending it to the browser.
 */

export const IMAGE_FOLDER = 'Amsons_Hrms';

const DELIVERY_TYPE = 'authenticated';
const ALLOWED_FORMATS = ['jpg', 'jpeg', 'png', 'webp'];

export const isImage = (mimeType) => String(mimeType ?? '').startsWith('image/');

export const isConfigured = () =>
  Boolean(env.cloudinary.cloudName && env.cloudinary.apiKey && env.cloudinary.apiSecret);

const client = () => {
  if (!isConfigured()) {
    throw new ApiError(503, 'Image storage is not configured', { code: 'IMAGE_STORAGE_NOT_CONFIGURED' });
  }

  cloudinary.config({
    cloud_name: env.cloudinary.cloudName,
    api_key: env.cloudinary.apiKey,
    api_secret: env.cloudinary.apiSecret,
    secure: true,
  });

  return cloudinary;
};

/**
 * Stores one image and returns the reference to keep.
 *
 * @param {string} path      The temporary file Multer wrote
 * @param {string} fileName  For the error message only
 * @returns {{ imageUrl, cloudinaryPublicId, imageFormat, imageSize }}
 */
export const uploadImage = async (path, fileName = 'That file') => {
  const storage = client();

  try {
    const result = await storage.uploader.upload(path, {
      folder: IMAGE_FOLDER,
      resource_type: 'image',
      type: DELIVERY_TYPE,
      use_filename: false,
      unique_filename: true,
      overwrite: false,
      allowed_formats: ALLOWED_FORMATS,
    });

    return {
      imageUrl: result.secure_url,
      cloudinaryPublicId: result.public_id,
      imageFormat: result.format,
      imageSize: result.bytes,
    };
  } catch (error) {
    const cause = error?.error ?? error;
    logger.error('Could not store an image', { httpCode: cause?.http_code, error: cause?.message });

    // A 400 is Cloudinary saying the bytes are not an image in an allowed
    // format, whatever the browser declared. Anything else is on our side.
    if (cause?.http_code === 400) throw ApiError.badRequest(`${fileName} is not a valid JPG, PNG or WEBP image`);
    throw new ApiError(502, 'The image could not be stored', { code: 'IMAGE_STORAGE_FAILED' });
  }
};

/**
 * Deletes one image. A failure is logged, not thrown: this runs after the record
 * has moved on, so failing here would report an error for a change that worked.
 * The cost is one unreferenced image, which the log names.
 */
export const deleteImage = async (publicId) => {
  if (!publicId) return false;

  try {
    const result = await client().uploader.destroy(publicId, {
      resource_type: 'image',
      type: DELIVERY_TYPE,
      invalidate: true,
    });

    return result?.result === 'ok' || result?.result === 'not found';
  } catch (error) {
    const cause = error?.error ?? error;
    logger.error('Could not delete an image', { publicId, error: cause?.message });
    return false;
  }
};

/** Opens a stored image as a stream, for the API to pass on behind its own checks. */
export const openImage = async (imageUrl) => {
  let response;
  try {
    response = await fetch(imageUrl);
  } catch (error) {
    logger.error('Could not reach image storage', { error: error.message });
    throw new ApiError(502, 'The image could not be loaded', { code: 'IMAGE_STORAGE_FAILED' });
  }

  if (!response.ok || !response.body) {
    logger.error('Image storage refused a stored image', { status: response.status });
    throw ApiError.notFound('The stored image is missing from image storage');
  }

  return Readable.fromWeb(response.body);
};

/** The fields a record keeps for an uploaded file, or none for a file kept on disk. */
export const imageReference = (file) =>
  file?.cloudinary
    ? {
        imageUrl: file.cloudinary.imageUrl,
        cloudinaryPublicId: file.cloudinary.cloudinaryPublicId,
        imageFormat: file.cloudinary.imageFormat,
      }
    : {};

/** Removes everything a request stored, wherever it went. Never throws. */
export const discardUploads = async (files = []) => {
  await Promise.all(
    files.map(async (file) => {
      if (file?.cloudinary) await deleteImage(file.cloudinary.cloudinaryPublicId);
      if (file?.path) await fsp.rm(file.path, { force: true }).catch(() => {});
    }),
  );
};

/**
 * Runs the steps that record an upload, undoing the upload if any of them fail.
 * Without this a refused request or a failed write would leave an image in
 * storage that nothing refers to.
 */
export const discardOnFailure = async (files, work) => {
  try {
    return await work();
  } catch (error) {
    await discardUploads(files);
    throw error;
  }
};

export default {
  IMAGE_FOLDER,
  isImage,
  isConfigured,
  uploadImage,
  deleteImage,
  openImage,
  imageReference,
  discardUploads,
  discardOnFailure,
};
