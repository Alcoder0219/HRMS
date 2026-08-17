import { API_BASE_URL } from '@services/api/axiosClient.js';

/**
 * Resolves an uploaded-file path to a URL the browser can actually fetch.
 *
 * The API stores root-relative paths (`/uploads/avatars/x.jpg`). A browser on
 * another machine resolves those against the WEB origin, not the API's -- so
 * they only work when something serves `/uploads` on that origin. Two setups
 * do, and this handles both:
 *
 *   - Relative API base (default): Vite proxies `/uploads` to the API, so the
 *     path is already correct and is returned untouched.
 *   - Absolute API base: the file lives on the API origin, so that origin is
 *     prefixed here.
 *
 * `VITE_FILE_BASE_URL` overrides the derived origin for a CDN or a separate
 * file host.
 */
const explicitBase = import.meta.env.VITE_FILE_BASE_URL?.replace(/\/+$/, '') ?? '';

/** Origin of the API when its base URL is absolute; empty when relative. */
const apiOrigin = (() => {
  if (explicitBase) return explicitBase;
  if (!/^https?:\/\//i.test(API_BASE_URL)) return '';

  try {
    return new URL(API_BASE_URL).origin;
  } catch {
    return '';
  }
})();

export const fileUrl = (filePath) => {
  if (!filePath) return undefined;

  // Already absolute (an S3 or CDN link) -- leave it alone.
  if (/^(https?:)?\/\//i.test(filePath) || filePath.startsWith('data:')) return filePath;

  const normalised = filePath.startsWith('/') ? filePath : `/${filePath}`;
  return `${apiOrigin}${normalised}`;
};

export default fileUrl;
