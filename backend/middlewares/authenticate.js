import ApiError from '../utils/ApiError.js';
import { ACCOUNT_STATUS, ERROR_CODES } from '../utils/constants.js';
import { verifyAccessToken } from '../helpers/token.helper.js';
import userRepository from '../repositories/auth/user.repository.js';

const extractBearer = (req) => {
  const header = req.get('Authorization') || '';
  if (!header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
};

/**
 * Verifies the access token and loads the current user.
 *
 * The database round trip is deliberate. A stateless claims-only check would
 * keep honouring a token after the account was suspended, its role downgraded
 * or its password changed -- for the full access-token lifetime. For an HRMS
 * holding payroll and PII, that window is not acceptable.
 */
const authenticate = async (req, _res, next) => {
  try {
    const token = extractBearer(req);
    if (!token) {
      return next(
        new ApiError(401, 'Authentication required', { code: ERROR_CODES.TOKEN_INVALID }),
      );
    }

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch (error) {
      const expired = error.name === 'TokenExpiredError';
      return next(
        new ApiError(401, expired ? 'Access token has expired' : 'Invalid access token', {
          // The client's refresh interceptor keys off this code to decide
          // whether a silent refresh is worth attempting.
          code: expired ? ERROR_CODES.TOKEN_EXPIRED : ERROR_CODES.TOKEN_INVALID,
        }),
      );
    }

    if (payload.type !== 'access') {
      return next(
        new ApiError(401, 'Invalid token type', { code: ERROR_CODES.TOKEN_INVALID }),
      );
    }

    const user = await userRepository.findById(payload.sub);
    if (!user) {
      return next(
        new ApiError(401, 'Account no longer exists', { code: ERROR_CODES.TOKEN_INVALID }),
      );
    }

    // Issued before the last password change -- the change was meant to end
    // exactly this session.
    if (user.isTokenStale(payload)) {
      return next(
        new ApiError(401, 'Password was changed. Please sign in again.', {
          code: ERROR_CODES.PASSWORD_CHANGED,
        }),
      );
    }

    if (user.isLocked || user.status !== ACCOUNT_STATUS.ACTIVE) {
      return next(
        new ApiError(401, 'This account is not active', {
          code: ERROR_CODES.INVALID_CREDENTIALS,
        }),
      );
    }

    req.user = {
      id: String(user._id),
      email: user.email,
      role: user.role,
      tenantId: user.tenantId ? String(user.tenantId) : null,
      // Read by the RBAC scope filters to narrow SELF / TEAM / DEPARTMENT
      // queries. Null until the Employee module links the records.
      employeeId: user.employeeId ? String(user.employeeId) : null,
      departmentId: user.departmentId ? String(user.departmentId) : null,
      mustChangePassword: user.mustChangePassword,
    };
    // Read by the repository layer to scope every query to one customer.
    req.tenantId = req.user.tenantId;
    req.currentUser = user;

    return next();
  } catch (error) {
    return next(error);
  }
};

export default authenticate;
