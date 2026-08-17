import { combineReducers } from '@reduxjs/toolkit';
import uiReducer from './slices/uiSlice.js';
import authReducer from './slices/authSlice.js';
import employeeReducer from './slices/employeeSlice.js';
import attendanceReducer from './slices/attendanceSlice.js';

/**
 * One registry of every slice in the app. Feature slices are added here as
 * modules are built, keeping the store shape visible in a single place.
 */
const rootReducer = combineReducers({
  ui: uiReducer,
  auth: authReducer,
  employees: employeeReducer,
  attendance: attendanceReducer,
});

export default rootReducer;
