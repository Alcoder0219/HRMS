import { PATHS } from '@routes/paths.js';

/**
 * One description of each organization master, shared by the list screen, the
 * add/edit form, the detail page and the breadcrumbs.
 *
 * The five masters are the same kind of object -- a named, coded reference list
 * -- and differ only in which extra fields they carry. Describing that
 * difference as data means one set of screens serves all five, and a change to
 * the layout or the validation lands once rather than five times.
 *
 * Mirrors the descriptor table in
 * backend/services/organization/organizationMaster.service.js. The server is
 * the authority: it validates every field again, and these rules only decide
 * what the form offers.
 */

const DAYS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

/**
 * `type` drives the input the form renders:
 *   text | textarea | number | money | time | select | days | switch
 */
export const ORGANIZATION_MASTERS = {
  units: {
    key: 'units',
    label: 'Unit',
    plural: 'Units',
    path: PATHS.units,
    subtitle: 'Locations and the employer registrations they file under',
    searchPlaceholder: 'Search name, code, city or region',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, width: 8, maxLength: 120 },
      { key: 'code', label: 'Code', type: 'text', required: true, width: 4, maxLength: 20, uppercase: true },
      { key: 'city', label: 'City', type: 'text', width: 4, maxLength: 80 },
      { key: 'state', label: 'Region', type: 'text', width: 4, maxLength: 80 },
      { key: 'address', label: 'Address', type: 'textarea', width: 12, maxLength: 300 },
      // Employer registrations are issued to the establishment, not the
      // company, so a multi-site tenant files under a different code per unit.
      {
        key: 'nssfEmployerCode',
        label: 'NSSF employer code',
        type: 'text',
        width: 4,
        maxLength: 40,
        uppercase: true,
      },
      { key: 'nhifEmployerCode', label: 'NHIF employer code', type: 'text', width: 4, maxLength: 40, uppercase: true },
      { key: 'wcfEmployerCode', label: 'WCF employer code', type: 'text', width: 4, maxLength: 40, uppercase: true },
    ],
  },

  departments: {
    key: 'departments',
    label: 'Department',
    plural: 'Departments',
    path: PATHS.departments,
    subtitle: 'Functional grouping used for scoping, approvals and cost reporting',
    searchPlaceholder: 'Search name, code or description',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, width: 8, maxLength: 100 },
      { key: 'code', label: 'Code', type: 'text', required: true, width: 4, maxLength: 20, uppercase: true },
      {
        key: 'parentId',
        label: 'Parent department',
        type: 'select',
        width: 6,
        // Populated from the picker list at render time.
        optionsFrom: 'departments',
        help: 'Leave blank for a top-level department',
      },
      { key: 'description', label: 'Description', type: 'textarea', width: 12, maxLength: 500 },
    ],
  },

  designations: {
    key: 'designations',
    label: 'Designation',
    plural: 'Designations',
    path: PATHS.designations,
    subtitle: 'Job titles and the seniority level each one sits at',
    searchPlaceholder: 'Search name or code',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, width: 8, maxLength: 100 },
      { key: 'code', label: 'Code', type: 'text', required: true, width: 4, maxLength: 20, uppercase: true },
      { key: 'level', label: 'Level', type: 'number', width: 4, min: 1, max: 20, help: '1 is most junior' },
      { key: 'departmentId', label: 'Department', type: 'select', width: 8, optionsFrom: 'departments' },
    ],
  },

  grades: {
    key: 'grades',
    label: 'Grade',
    plural: 'Grades',
    path: PATHS.grades,
    subtitle: 'Pay bands and the gross range each one covers',
    searchPlaceholder: 'Search name, code or description',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, width: 8, maxLength: 60 },
      { key: 'code', label: 'Code', type: 'text', required: true, width: 4, maxLength: 20, uppercase: true },
      { key: 'level', label: 'Level', type: 'number', width: 4, min: 1, max: 100 },
      { key: 'minGross', label: 'Minimum gross', type: 'money', width: 4 },
      { key: 'maxGross', label: 'Maximum gross', type: 'money', width: 4 },
      { key: 'description', label: 'Description', type: 'textarea', width: 12, maxLength: 250 },
    ],
    /** Caught here as well as on the server, so the message lands on the field. */
    validate: (form) => {
      const min = Number(form.minGross) || 0;
      const max = Number(form.maxGross) || 0;
      if (max > 0 && max < min) return { maxGross: 'Maximum gross cannot be below the minimum' };
      return null;
    },
  },

  shifts: {
    key: 'shifts',
    label: 'Shift',
    plural: 'Shifts',
    path: PATHS.shifts,
    subtitle: 'Rostered working windows that attendance is graded against',
    searchPlaceholder: 'Search name or code',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, width: 8, maxLength: 60 },
      { key: 'code', label: 'Code', type: 'text', required: true, width: 4, maxLength: 20, uppercase: true },
      { key: 'startTime', label: 'Start time', type: 'time', required: true, width: 4 },
      { key: 'endTime', label: 'End time', type: 'time', required: true, width: 4 },
      { key: 'breakMinutes', label: 'Break (minutes)', type: 'number', width: 4, min: 0, max: 480 },
      {
        key: 'isNightShift',
        label: 'Night shift',
        type: 'switch',
        width: 6,
        help: 'Crosses midnight — attendance is graded against the previous day',
      },
      { key: 'weeklyOffs', label: 'Weekly offs', type: 'days', width: 12, options: DAYS },
    ],
    validate: (form) => {
      // A shift that starts and ends at the same minute has no duration, and
      // the rules engine would grade every day against a zero-length window.
      if (form.startTime && form.endTime && form.startTime === form.endTime) {
        return { endTime: 'Start and end time cannot be the same' };
      }
      return null;
    },
  },
};

export const MASTER_KEYS = Object.keys(ORGANIZATION_MASTERS);

export const WEEK_DAYS = DAYS;

/** Blank form values for a master, so an add dialog starts from a known shape. */
export const emptyForm = (master) => {
  const config = ORGANIZATION_MASTERS[master];
  if (!config) return {};

  return Object.fromEntries(
    config.fields.map((field) => {
      if (field.type === 'switch') return [field.key, false];
      if (field.type === 'days') return [field.key, [0]];
      return [field.key, ''];
    }),
  );
};

export default ORGANIZATION_MASTERS;
