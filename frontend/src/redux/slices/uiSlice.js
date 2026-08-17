import { createSlice } from '@reduxjs/toolkit';
import { CURRENCY_KEY, THEME_MODE_KEY, getItem, setItem } from '@utils/storage.js';
import { DEFAULT_CURRENCY_CODE, normalizeCurrencyCode, setActiveCurrency } from '@utils/currency.js';

/**
 * The saved currency, normalized on the way in: the value comes from
 * localStorage, so it may be stale from a build that offered a currency this
 * one does not, and an unknown code has to fall back rather than blank every
 * amount in the app.
 */
const storedCurrency = normalizeCurrencyCode(getItem(CURRENCY_KEY, DEFAULT_CURRENCY_CODE));

/**
 * `formatCurrency` is a plain function -- grid formatters and exporters call
 * it outside React -- so it reads the currency from a module register instead
 * of from the store. Seed that register here, at load, so the first paint
 * after a refresh is already in the saved currency rather than in the default.
 */
setActiveCurrency(storedCurrency);

/**
 * Global presentation state: theme scheme, display currency and shell layout.
 * Kept in Redux because the layout, the topbar and the theme provider all read
 * it, and it has to survive navigation.
 */
const initialState = {
  themeMode: getItem(THEME_MODE_KEY, 'light'),
  currency: storedCurrency,
  sidebarOpen: true,
  sidebarCollapsed: false,
  globalLoading: false,
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setThemeMode(state, action) {
      state.themeMode = action.payload;
      setItem(THEME_MODE_KEY, action.payload);
    },
    toggleThemeMode(state) {
      state.themeMode = state.themeMode === 'light' ? 'dark' : 'light';
      setItem(THEME_MODE_KEY, state.themeMode);
    },
    /**
     * Persisted like the theme, and outside the auth state on purpose: how a
     * user wants amounts written is a preference of theirs, not of the
     * session, so it survives signing out and back in.
     */
    setCurrency(state, action) {
      state.currency = setActiveCurrency(action.payload);
      setItem(CURRENCY_KEY, state.currency);
    },
    toggleSidebar(state) {
      state.sidebarOpen = !state.sidebarOpen;
    },
    setSidebarOpen(state, action) {
      state.sidebarOpen = action.payload;
    },
    toggleSidebarCollapsed(state) {
      state.sidebarCollapsed = !state.sidebarCollapsed;
    },
    setGlobalLoading(state, action) {
      state.globalLoading = action.payload;
    },
  },
});

export const {
  setThemeMode,
  toggleThemeMode,
  setCurrency,
  toggleSidebar,
  setSidebarOpen,
  toggleSidebarCollapsed,
  setGlobalLoading,
} = uiSlice.actions;

export const selectThemeMode = (state) => state.ui.themeMode;
export const selectCurrency = (state) => state.ui.currency;
export const selectSidebarOpen = (state) => state.ui.sidebarOpen;
export const selectSidebarCollapsed = (state) => state.ui.sidebarCollapsed;

export default uiSlice.reducer;
