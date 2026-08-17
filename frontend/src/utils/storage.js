export const ACCESS_TOKEN_KEY = 'hrms.accessToken';
export const THEME_MODE_KEY = 'hrms.themeMode';
export const CURRENCY_KEY = 'hrms.currency';

/**
 * localStorage wrapper. Every access is guarded because storage throws in
 * private-browsing modes and when a quota is exceeded -- an unguarded read is
 * enough to blank the whole app.
 */
export const getItem = (key, fallback = null) => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
};

export const setItem = (key, value) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

export const removeItem = (key) => {
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
};

export const getAccessToken = () => getItem(ACCESS_TOKEN_KEY);
export const setAccessToken = (token) => setItem(ACCESS_TOKEN_KEY, token);
export const clearAccessToken = () => removeItem(ACCESS_TOKEN_KEY);
