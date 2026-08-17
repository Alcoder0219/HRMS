import { useEffect, useState } from 'react';
import Avatar from '@mui/material/Avatar';

import employeeService from '@services/modules/employee.service.js';
import { cachedObjectUrl } from './AuthenticatedImage.jsx';
import { fileUrl } from '@utils/fileUrl.js';
import { initials } from '@utils/format.js';

/**
 * One employee avatar, used everywhere an employee is shown by name.
 *
 * The fallback rule is the point: when there is no photograph the initials are
 * shown, and they are derived the same way in the list, the detail page, the
 * profile header and search. That was previously repeated at each call site.
 *
 * Photographs can come from either of two places, which is a consequence of
 * the product's history rather than a design:
 *
 *   `employee.photo` -- the legacy avatar, served statically, no auth needed.
 *     Cheap, so it is what the list uses for hundreds of rows.
 *
 *   `photoDocumentId` -- a PHOTO document in the attachments folder, which is
 *     NOT served statically and needs an authenticated request. Passed only on
 *     screens showing one employee, where a single extra fetch is affordable.
 *     Handing it to a list of two hundred rows would mean two hundred requests.
 */
const EmployeeAvatar = ({
  employee,
  employeeId = null,
  photoDocumentId = null,
  size = 40,
  fontSize = null,
  sx = null,
  ...rest
}) => {
  const legacy = fileUrl(employee?.photo?.filePath);
  const [authenticated, setAuthenticated] = useState(() => cachedObjectUrl(photoDocumentId));

  useEffect(() => {
    // The legacy photo wins when present: it costs nothing and is already
    // rendering by the time this would resolve.
    if (legacy || !photoDocumentId || !employeeId) return undefined;

    const cached = cachedObjectUrl(photoDocumentId);
    if (cached) {
      setAuthenticated(cached);
      return undefined;
    }

    let cancelled = false;

    employeeService
      .downloadAttachment(employeeId, photoDocumentId, 'inline')
      .then((blob) => {
        if (!cancelled) setAuthenticated(URL.createObjectURL(blob));
      })
      .catch(() => {
        // No photo is not an error: the initials below are a valid answer.
        if (!cancelled) setAuthenticated(null);
      });

    return () => {
      cancelled = true;
    };
  }, [legacy, photoDocumentId, employeeId]);

  const source = legacy || authenticated || undefined;

  return (
    <Avatar
      src={source}
      alt={`${employee?.firstName ?? ''} ${employee?.lastName ?? ''}`.trim() || 'Employee'}
      sx={{
        width: size,
        height: size,
        fontSize: fontSize ?? Math.round(size * 0.38),
        bgcolor: source ? undefined : 'primary.main',
        ...sx,
      }}
      {...rest}
    >
      {initials(employee?.firstName, employee?.lastName)}
    </Avatar>
  );
};

export default EmployeeAvatar;
