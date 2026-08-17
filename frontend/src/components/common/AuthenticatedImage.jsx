import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import BrokenIcon from '@mui/icons-material/BrokenImageOutlined';

import employeeService from '@services/modules/employee.service.js';

/**
 * An image whose bytes need an Authorization header.
 *
 * Attachments are not served statically -- a passport scan must not be
 * readable by anyone who learns its URL -- so `<img src>` cannot fetch one.
 * This pulls the blob through the authenticated endpoint and renders the
 * object URL instead.
 *
 * Two things make that affordable at nine cards a page:
 *
 *   Nothing loads until the element is actually on screen. An IntersectionObserver
 *   holds the request until the card scrolls into view, so opening the tab does
 *   not pull every full-size image at once.
 *
 *   Blobs are cached per document id for the life of the page, so re-rendering,
 *   collapsing a group, or opening the same file in the viewer costs nothing.
 */

/**
 * Module-level rather than component state on purpose: the cache has to outlive
 * the card that populated it, or scrolling a group out of view and back would
 * refetch every thumbnail.
 */
const blobCache = new Map();

export const cachedObjectUrl = (documentId) => blobCache.get(documentId) ?? null;

/**
 * Frees every cached object URL.
 *
 * Object URLs are held by the document until revoked; without this, browsing
 * several employees in one session leaks each one's images.
 */
export const releaseImageCache = () => {
  blobCache.forEach((url) => URL.revokeObjectURL(url));
  blobCache.clear();
};

const loadImage = async (employeeId, documentId) => {
  if (blobCache.has(documentId)) return blobCache.get(documentId);

  const blob = await employeeService.downloadAttachment(employeeId, documentId, 'inline');
  const url = URL.createObjectURL(blob);

  blobCache.set(documentId, url);
  return url;
};

const AuthenticatedImage = ({
  employeeId,
  documentId,
  alt = '',
  height = 180,
  width = '100%',
  fit = 'cover',
  rounded = 1,
  eager = false,
  onLoaded = null,
}) => {
  const holderRef = useRef(null);
  const [url, setUrl] = useState(() => cachedObjectUrl(documentId));
  const [visible, setVisible] = useState(eager);
  const [failed, setFailed] = useState(false);

  // Watch for the card entering the viewport. Disconnects on first hit: once
  // loaded there is nothing left to observe.
  useEffect(() => {
    if (visible || !holderRef.current) return undefined;

    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      // A little ahead of the fold, so the image is usually there by the time
      // the card is.
      { rootMargin: '200px' },
    );

    observer.observe(holderRef.current);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || url || !employeeId || !documentId) return undefined;

    let cancelled = false;

    loadImage(employeeId, documentId)
      .then((objectUrl) => {
        if (cancelled) return;
        setUrl(objectUrl);
        onLoaded?.(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [visible, url, employeeId, documentId, onLoaded]);

  return (
    <Box
      ref={holderRef}
      sx={{
        width,
        height,
        borderRadius: rounded,
        overflow: 'hidden',
        bgcolor: 'action.hover',
        display: 'grid',
        placeItems: 'center',
        color: 'text.disabled',
      }}
    >
      {url && (
        <Box
          component="img"
          src={url}
          alt={alt}
          loading="lazy"
          sx={{ width: '100%', height: '100%', objectFit: fit, display: 'block' }}
        />
      )}

      {!url && failed && <BrokenIcon />}
      {!url && !failed && <Skeleton variant="rectangular" width="100%" height="100%" />}
    </Box>
  );
};

export default AuthenticatedImage;
