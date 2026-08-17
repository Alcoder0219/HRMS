import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import employeeService from '@services/modules/employee.service.js';
import organizationService from '@services/modules/organization.service.js';
import { getRowId } from '@utils/dataGrid.js';

const asError = (error) => ({
  message: error?.message ?? 'Something went wrong',
  details: error?.details ?? null,
});

export const DEFAULT_FILTERS = {
  search: '',
  status: '',
  departmentId: '',
  designationId: '',
  employmentType: '',
  joinedFrom: '',
  joinedTo: '',
};

const initialState = {
  items: [],
  total: 0,
  page: 1,
  limit: 25,
  sortBy: 'employeeCode',
  sortOrder: 'asc',
  filters: { ...DEFAULT_FILTERS },

  summary: null,
  // Extended with the new pickers. Defaults stay empty arrays so a component
  // rendering a dropdown never has to guard against undefined.
  masters: {
    departments: [],
    designations: [],
    shifts: [],
    units: [],
    grades: [],
    salaryTemplates: [],
    reportingManagers: [],
    // Company defaults the overtime section calculates against.
    // No monthly-hours default: the overtime divisor is the payroll month's own
  // length × 8 hrs, computed per month rather than read from a setting.
  payrollDefaults: { overtimeMultiplier: 2, currency: 'INR' },
  },

  current: null,
  status: 'idle',
  saving: false,
  error: null,
};

/** Everything the list query needs, assembled from slice state in one place. */
const listParams = (state) => ({
  page: state.page,
  limit: state.limit,
  sortBy: state.sortBy,
  sortOrder: state.sortOrder,
  ...state.filters,
});

export const fetchEmployees = createAsyncThunk(
  'employees/fetch',
  async (_, { getState, rejectWithValue }) => {
    try {
      const response = await employeeService.list(listParams(getState().employees));
      return { items: response.data, meta: response.meta };
    } catch (error) {
      return rejectWithValue(asError(error));
    }
  },
);

export const fetchSummary = createAsyncThunk('employees/summary', async (_, { rejectWithValue }) => {
  try {
    return (await employeeService.summary()).data;
  } catch (error) {
    return rejectWithValue(asError(error));
  }
});

export const fetchMasters = createAsyncThunk('employees/masters', async (_, { rejectWithValue }) => {
  try {
    return (await organizationService.masters()).data;
  } catch (error) {
    return rejectWithValue(asError(error));
  }
});

export const fetchEmployee = createAsyncThunk('employees/one', async (id, { rejectWithValue }) => {
  try {
    return (await employeeService.getOne(id)).data;
  } catch (error) {
    return rejectWithValue(asError(error));
  }
});

export const saveEmployee = createAsyncThunk(
  'employees/save',
  async ({ id, payload }, { rejectWithValue }) => {
    try {
      const response = id
        ? await employeeService.update(id, payload)
        : await employeeService.create(payload);
      return response.data;
    } catch (error) {
      // Field-level details are forwarded so the form can attach each message
      // to the input that caused it.
      return rejectWithValue(asError(error));
    }
  },
);

export const changeEmployeeStatus = createAsyncThunk(
  'employees/changeStatus',
  async ({ id, payload }, { rejectWithValue }) => {
    try {
      return (await employeeService.changeStatus(id, payload)).data;
    } catch (error) {
      return rejectWithValue(asError(error));
    }
  },
);

export const deleteEmployee = createAsyncThunk(
  'employees/delete',
  async ({ id, reason, purgeAttachments = false }, { rejectWithValue }) => {
    try {
      await employeeService.remove(id, reason, purgeAttachments);
      return id;
    } catch (error) {
      return rejectWithValue(asError(error));
    }
  },
);

const employeeSlice = createSlice({
  name: 'employees',
  initialState,
  reducers: {
    setPage(state, action) {
      state.page = action.payload;
    },
    setLimit(state, action) {
      state.limit = action.payload;
      // A page-size change invalidates the current offset.
      state.page = 1;
    },
    setSort(state, action) {
      state.sortBy = action.payload.sortBy;
      state.sortOrder = action.payload.sortOrder;
    },
    setFilters(state, action) {
      state.filters = { ...state.filters, ...action.payload };
      // Any filter change resets to the first page: staying on page 7 of a
      // freshly narrowed result set shows an empty table.
      state.page = 1;
    },
    resetFilters(state) {
      state.filters = { ...DEFAULT_FILTERS };
      state.page = 1;
    },
    clearCurrent(state) {
      state.current = null;
      state.error = null;
    },
    clearError(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchEmployees.pending, (state) => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(fetchEmployees.fulfilled, (state, action) => {
        state.items = action.payload.items;
        state.total = action.payload.meta?.total ?? action.payload.items.length;
        state.status = 'succeeded';
      })
      .addCase(fetchEmployees.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.payload;
      })

      .addCase(fetchSummary.fulfilled, (state, action) => {
        state.summary = action.payload;
      })
      .addCase(fetchMasters.fulfilled, (state, action) => {
        // Merged rather than replaced, so a server that has not yet been
        // upgraded (returning only the original three lists) leaves the new
        // keys as empty arrays instead of undefined.
        state.masters = { ...state.masters, ...action.payload };
      })

      .addCase(fetchEmployee.pending, (state) => {
        state.status = 'loading';
        state.current = null;
      })
      .addCase(fetchEmployee.fulfilled, (state, action) => {
        state.current = action.payload;
        state.status = 'succeeded';
      })
      .addCase(fetchEmployee.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.payload;
      })

      .addCase(saveEmployee.pending, (state) => {
        state.saving = true;
        state.error = null;
      })
      .addCase(saveEmployee.fulfilled, (state, action) => {
        state.saving = false;
        state.current = action.payload;
      })
      .addCase(saveEmployee.rejected, (state, action) => {
        state.saving = false;
        state.error = action.payload;
      })

      .addCase(changeEmployeeStatus.fulfilled, (state, action) => {
        state.current = action.payload;
        // Matched on `_id`: list rows come from a lean query and have no `id`,
        // so comparing `id` never matched and the row silently went stale.
        const updatedId = getRowId(action.payload);
        const index = state.items.findIndex((item) => getRowId(item) === updatedId);
        if (index !== -1) state.items[index] = { ...state.items[index], ...action.payload };
      })

      .addCase(deleteEmployee.fulfilled, (state, action) => {
        state.items = state.items.filter((item) => getRowId(item) !== action.payload);
        state.total = Math.max(0, state.total - 1);
      });
  },
});

export const { setPage, setLimit, setSort, setFilters, resetFilters, clearCurrent, clearError } =
  employeeSlice.actions;

export const selectEmployees = (state) => state.employees;
export const selectMasters = (state) => state.employees.masters;
export const selectCurrentEmployee = (state) => state.employees.current;

export default employeeSlice.reducer;
