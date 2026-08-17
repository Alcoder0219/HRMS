import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import attendanceService, { readPosition } from '@services/modules/attendance.service.js';

const asError = (error) => ({
  message: error?.message ?? 'Something went wrong',
  details: error?.details ?? null,
  code: error?.code ?? null,
});

const today = () => new Date().toISOString().slice(0, 10);

export const DEFAULT_FILTERS = { status: '', employeeId: '', from: today(), to: today() };

const initialState = {
  today: null,
  calendar: null,
  compOff: null,

  items: [],
  total: 0,
  page: 1,
  limit: 25,
  // Server-side sorting: the register grid reports intent, the API orders.
  sortBy: 'date',
  sortOrder: 'desc',
  filters: { ...DEFAULT_FILTERS },
  summary: null,

  register: null,
  regularizations: [],
  regularizationTotal: 0,
  pending: 0,

  status: 'idle',
  punching: false,
  error: null,
};

export const fetchToday = createAsyncThunk('attendance/today', async (_, { rejectWithValue }) => {
  try {
    return (await attendanceService.myToday()).data;
  } catch (error) {
    return rejectWithValue(asError(error));
  }
});

/**
 * Location is read before the request and sent alongside it. The browser
 * prompt is asynchronous, so this cannot be folded into the interceptor.
 */
export const punch = createAsyncThunk('attendance/punch', async (_, { rejectWithValue }) => {
  try {
    const location = await readPosition();
    return (await attendanceService.punch(location ? { location } : {})).data;
  } catch (error) {
    return rejectWithValue(asError(error));
  }
});

export const fetchCalendar = createAsyncThunk(
  'attendance/calendar',
  async ({ year, month, employeeId }, { rejectWithValue }) => {
    try {
      return (await attendanceService.myCalendar({ year, month, employeeId })).data;
    } catch (error) {
      return rejectWithValue(asError(error));
    }
  },
);

export const fetchCompOff = createAsyncThunk(
  'attendance/compOff',
  async (employeeId, { rejectWithValue }) => {
    try {
      return (await attendanceService.compOff(employeeId)).data;
    } catch (error) {
      return rejectWithValue(asError(error));
    }
  },
);

export const fetchRegister = createAsyncThunk(
  'attendance/list',
  async (_, { getState, rejectWithValue }) => {
    const { page, limit, sortBy, sortOrder, filters } = getState().attendance;
    try {
      const response = await attendanceService.list({ page, limit, sortBy, sortOrder, ...filters });
      return { items: response.data, meta: response.meta };
    } catch (error) {
      return rejectWithValue(asError(error));
    }
  },
);

export const fetchDailySummary = createAsyncThunk(
  'attendance/dailySummary',
  async (date, { rejectWithValue }) => {
    try {
      return (await attendanceService.dailySummary(date)).data;
    } catch (error) {
      return rejectWithValue(asError(error));
    }
  },
);

export const fetchMonthlyRegister = createAsyncThunk(
  'attendance/monthly',
  async (params, { rejectWithValue }) => {
    try {
      return (await attendanceService.monthlyRegister(params)).data;
    } catch (error) {
      return rejectWithValue(asError(error));
    }
  },
);

export const fetchRegularizations = createAsyncThunk(
  'attendance/regularizations',
  async (params, { rejectWithValue }) => {
    try {
      const response = await attendanceService.regularizations(params);
      return { items: response.data, meta: response.meta };
    } catch (error) {
      return rejectWithValue(asError(error));
    }
  },
);

export const fetchPendingCount = createAsyncThunk(
  'attendance/pendingCount',
  async (_, { rejectWithValue }) => {
    try {
      return (await attendanceService.pendingCount()).data;
    } catch (error) {
      return rejectWithValue(asError(error));
    }
  },
);

const attendanceSlice = createSlice({
  name: 'attendance',
  initialState,
  reducers: {
    setPage(state, action) {
      state.page = action.payload;
    },
    setLimit(state, action) {
      state.limit = action.payload;
      state.page = 1;
    },
    setSort(state, action) {
      state.sortBy = action.payload.sortBy;
      state.sortOrder = action.payload.sortOrder;
    },
    setFilters(state, action) {
      state.filters = { ...state.filters, ...action.payload };
      state.page = 1;
    },
    resetFilters(state) {
      state.filters = { ...DEFAULT_FILTERS };
      state.page = 1;
    },
    clearError(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchToday.fulfilled, (state, action) => {
        state.today = action.payload;
      })

      .addCase(punch.pending, (state) => {
        state.punching = true;
        state.error = null;
      })
      .addCase(punch.fulfilled, (state) => {
        state.punching = false;
      })
      .addCase(punch.rejected, (state, action) => {
        state.punching = false;
        state.error = action.payload;
      })

      .addCase(fetchCalendar.fulfilled, (state, action) => {
        state.calendar = action.payload;
      })
      .addCase(fetchCompOff.fulfilled, (state, action) => {
        state.compOff = action.payload;
      })

      .addCase(fetchRegister.pending, (state) => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(fetchRegister.fulfilled, (state, action) => {
        state.items = action.payload.items;
        state.total = action.payload.meta?.total ?? action.payload.items.length;
        state.status = 'succeeded';
      })
      .addCase(fetchRegister.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.payload;
      })

      .addCase(fetchDailySummary.fulfilled, (state, action) => {
        state.summary = action.payload;
      })
      .addCase(fetchMonthlyRegister.fulfilled, (state, action) => {
        state.register = action.payload;
      })

      .addCase(fetchRegularizations.fulfilled, (state, action) => {
        state.regularizations = action.payload.items;
        state.regularizationTotal = action.payload.meta?.total ?? action.payload.items.length;
      })
      .addCase(fetchPendingCount.fulfilled, (state, action) => {
        state.pending = action.payload.pending;
      });
  },
});

export const { setPage, setLimit, setSort, setFilters, resetFilters, clearError } =
  attendanceSlice.actions;

export const selectAttendance = (state) => state.attendance;

export default attendanceSlice.reducer;
