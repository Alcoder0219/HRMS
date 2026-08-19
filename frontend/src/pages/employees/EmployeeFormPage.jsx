import { Fragment, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';

import PageHeader from '@components/common/PageHeader.jsx';
import CurrencyAdornment from '@components/common/CurrencyAdornment.jsx';
import { useAppDispatch, useAppSelector } from '@hooks/useRedux.js';
import {
  fetchEmployee,
  fetchMasters,
  saveEmployee,
  clearCurrent,
  selectEmployees,
} from '@redux/slices/employeeSlice.js';
import { toDateInput, formatCurrency, formatDate } from '@utils/format.js';
import { getRowId, employeeIdentifiers } from '@utils/dataGrid.js';
import {
  GENDER_OPTIONS,
  MARITAL_STATUS_OPTIONS,
  BLOOD_GROUP_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  EMPLOYEE_CATEGORY_OPTIONS,
  EMPLOYEE_STATUS_OPTIONS,
  BANK_ACCOUNT_TYPE_OPTIONS,
  SALARY_EARNING_FIELDS,
  SALARY_DEDUCTION_FIELDS,
  SALARY_EMPLOYER_FIELDS,
  OVERTIME_METHOD_OPTIONS,
  OVERTIME_MULTIPLIER_OPTIONS,
  PREMIUM_MULTIPLIER_OPTIONS,
  OVERTIME_PREMIUM_FIELDS,
  PORTAL_ROLE_OPTIONS,
  PORTAL_STATUS_OPTIONS,
} from '@utils/employeeOptions.js';
import { PATHS } from '@routes/paths.js';
import EmployeeDocumentsTab from './components/EmployeeDocumentsTab.jsx';

// Existing tabs are untouched and keep their order; the new sections are
// appended so muscle memory and any deep link to a tab index still hold.
const TABS = [
  'Personal',
  'Employment',
  'Statutory',
  'Salary',
  'Bank & Emergency',
  'Address',
  'Additional',
  // Appended, so every existing tab index is unchanged.
  'Documents',
];

/** The index of the Documents tab, named rather than repeated as a literal. */
const DOCUMENTS_TAB = TABS.indexOf('Documents');

const EMPTY_SALARY = {
  ctc: '',
  grade: '',
  band: '',
  basic: '',
  hraAllowance: '',
  foodAllowance: '',
  transportationAllowance: '',
  communicationAllowance: '',
  mediclaim: '',
  schoolFeesAllowance: '',
  // Held as its monthly equivalent, matching the field on the server.
  annualLeaveAllowance: '',
  performanceIncentive: '',
  nssfEmployee: '',
  nssfEmployer: '',
  nhif: '',
  sdl: '',
  wcf: '',
  paye: '',
};

const EMPTY = {
  employeeId: '',
  firstName: '',
  middleName: '',
  lastName: '',
  fatherName: '',
  motherName: '',
  gender: 'UNDISCLOSED',
  dateOfBirth: '',
  bloodGroup: '',
  maritalStatus: '',
  personalEmail: '',
  mobile: '',
  alternateMobile: '',
  workEmail: '',
  joiningDate: '',
  confirmationDate: '',
  probationMonths: '',
  departmentId: '',
  designationId: '',
  shiftId: '',
  reportingManagerId: '',
  unitId: '',
  gradeId: '',
  salaryTemplateId: '',
  employmentType: 'FULL_TIME',
  employeeCategory: '',
  overtimeEligible: false,
  // Held as "HH:MM" because that is how a working day is written and read; the
  // API takes minutes, and the two conversions live beside this constant.
  standardDutyHours: '08:30',
  workLocation: '',

  /* ----------------------------------------------------- portal access -- */
  // Not employee fields. The server splits these off and applies them to the
  // login account; see backend/services/employee/portalAccess.service.js.
  portalAccess: false,
  portalEmail: '',
  portalRole: 'EMPLOYEE',
  portalPassword: '',
  portalStatus: 'ACTIVE',

  salaryStructure: EMPTY_SALARY,
  overtime: {
    eligible: false,
    calculationMethod: 'SALARY_BASED',
    fixedHourlyRate: '',
    workingHoursPerMonth: '',
    multiplier: '1.5',
    customMultiplier: '',
    maxDailyOT: '',
    maxMonthlyOT: '',
    weeklyHolidayMultiplier: '2',
    weeklyHolidayCustomMultiplier: '',
    publicHolidayMultiplier: '2',
    publicHolidayCustomMultiplier: '',
    nightShiftMultiplier: '1.5',
    nightShiftCustomMultiplier: '',
  },
  statutory: {
    nssfNumber: '',
    nhifNumber: '',
    tinNumber: '',
    nationalIdNumber: '',
    passportNumber: '',
    drivingLicense: '',
    workPermitNumber: '',
    // All three default on, matching the schema: NSSF, NHIF and PAYE apply to
    // essentially every employed person here, so the exception is the employee
    // held outside one of them.
    nssfApplicable: true,
    nhifApplicable: true,
    payeApplicable: true,
  },
  bankDetails: {
    accountHolderName: '',
    accountNumber: '',
    bankName: '',
    branch: '',
    swiftCode: '',
    branchCode: '',
    accountType: '',
  },
  emergencyContacts: [
    { name: '', relationship: '', phone: '', alternatePhone: '', isPrimary: true },
  ],
  currentAddress: { line1: '', line2: '', city: '', state: '', postalCode: '', country: 'Tanzania' },
  permanentAddress: { line1: '', line2: '', city: '', state: '', postalCode: '', country: 'Tanzania' },
  sameAsCurrentAddress: false,
  remarks: '',
  notes: '',
};

/** Maps an API record onto the flat form shape, normalising dates and nulls. */
const toFormState = (employee) => ({
  ...EMPTY,
  ...employee,
  dateOfBirth: toDateInput(employee.dateOfBirth),
  joiningDate: toDateInput(employee.joiningDate),
  confirmationDate: toDateInput(employee.confirmationDate),
  departmentId: employee.departmentId?._id ?? employee.departmentId ?? '',
  designationId: employee.designationId?._id ?? employee.designationId ?? '',
  shiftId: employee.shiftId?._id ?? employee.shiftId ?? '',
  reportingManagerId: employee.reportingManagerId?._id ?? employee.reportingManagerId ?? '',
  // Populated refs arrive as objects on a detail fetch and as ids elsewhere.
  unitId: employee.unitId?._id ?? employee.unitId ?? '',
  gradeId: employee.gradeId?._id ?? employee.gradeId ?? '',
  salaryTemplateId: employee.salaryTemplateId?._id ?? employee.salaryTemplateId ?? '',

  /**
   * Portal access, read from the populated login account.
   *
   * A DEACTIVATED account is shown as access OFF. The link from the employee is
   * kept on the server so the history survives and a returning employee gets
   * their old account back, but "deactivated" is not access -- showing the
   * toggle on would claim this person can sign in when they cannot.
   */
  portalAccess: Boolean(employee.userId) && employee.userId?.status !== 'DEACTIVATED',
  portalEmail: employee.userId?.email ?? employee.workEmail ?? '',
  portalRole: employee.userId?.role ?? 'EMPLOYEE',
  // Never prefilled. The server does not return it and blank means "unchanged".
  portalPassword: '',
  portalStatus:
    employee.userId?.status && employee.userId.status !== 'DEACTIVATED'
      ? employee.userId.status
      : 'ACTIVE',

  salaryStructure: { ...EMPTY.salaryStructure, ...(employee.salaryStructure ?? {}) },
  // Records predating this field have no figure, so they read the 08:30 default.
  standardDutyHours: dutyToInput(employee.standardDutyMinutes),
  // Records predating the overtime section have no sub-document; the defaults
  // fill in so every control stays controlled.
  overtime: {
    ...EMPTY.overtime,
    ...(employee.overtime ?? {}),
    eligible: employee.overtime?.eligible ?? employee.overtimeEligible ?? false,
  },
  statutory: { ...EMPTY.statutory, ...(employee.statutory ?? {}) },
  bankDetails: { ...EMPTY.bankDetails, ...(employee.bankDetails ?? {}) },
  emergencyContacts: employee.emergencyContacts?.length
    ? employee.emergencyContacts
    : EMPTY.emergencyContacts,
  currentAddress: { ...EMPTY.currentAddress, ...(employee.currentAddress ?? {}) },
  permanentAddress: { ...EMPTY.permanentAddress, ...(employee.permanentAddress ?? {}) },
});

/**
 * Standard duty hours, between the minutes the API stores and the "HH:MM" a
 * person reads. An unparseable entry falls back to the 08:30 company default
 * rather than to zero, which would make every worked minute overtime.
 */
const DEFAULT_DUTY_MINUTES = 510;

/**
 * A standard working day, for pricing an overtime hour.
 *
 * Overtime divides monthly gross by the payroll month's days times this, so
 * the divisor is 248 in August and 224 in February. Mirrors
 * STANDARD_DAILY_WORKING_HOURS in backend/helpers/overtimeRate.helper.js.
 */
const STANDARD_DAILY_WORKING_HOURS = 8;

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

const dutyToInput = (minutes) => {
  const total = Number.isFinite(Number(minutes)) ? Number(minutes) : DEFAULT_DUTY_MINUTES;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

const dutyToMinutes = (value) => {
  const [hours, minutes] = String(value ?? '').split(':');
  const total = Number(hours) * 60 + Number(minutes);
  return Number.isFinite(total) && total >= 0 && total <= 1440 ? Math.round(total) : DEFAULT_DUTY_MINUTES;
};

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Currency is rounded to two decimal places everywhere it is shown or stored. */
const round = (value) => Math.round((Number(value) || 0) * 100) / 100;

/**
 * Live salary arithmetic, mirroring `deriveSalaryTotals` on the server.
 *
 * Every formula here is duplicated in `backend/models/employee/employee.model.js`.
 * The client copy exists so the totals move as you type; the server recomputes
 * and stores its own, because a total arriving in a request body is
 * attacker-supplied.
 *
 *   Gross            = basic + every allowance
 *   Employee ded.    = NSSF(ee) + NHIF + PAYE
 *   Employer contrib = NSSF(er) + SDL + WCF
 *   Net              = Gross − employee deductions
 *   Monthly CTC      = Gross
 *   Cost to company  = Net + employee deductions + employer contributions
 *   Annual CTC       = Monthly CTC × 12
 *   Total amount     = Net + bonus
 *
 * Bonus sits outside gross and outside CTC by policy, and is added only at the
 * final total.
 */
const calculateTotals = (salary = {}) => {
  const sum = (fields) => fields.reduce((total, field) => total + toNumber(salary[field.key]), 0);

  /**
   * The earning components sum to GROSS, undiminished.
   *
   * The employer's NSSF, SDL and WCF are a cost the company carries on top of
   * the salary, not something the employee earns and then loses, so they are
   * not netted out here -- they are reported separately and added back for the
   * true cost to company. Mirrors `deriveSalaryTotals` on the server exactly,
   * so the figures on screen are the figures that get saved.
   */
  const monthlyCtc = round(sum(SALARY_EARNING_FIELDS));
  const employerContribution = round(sum(SALARY_EMPLOYER_FIELDS));
  const totalDeductions = round(sum(SALARY_DEDUCTION_FIELDS));

  // Floored at zero -- a negative wage is a data-entry error, not a figure to
  // display.
  const grossSalary = monthlyCtc;
  const netSalary = Math.max(0, round(grossSalary - totalDeductions));

  const bonus = Math.max(0, round(toNumber(salary.bonus)));

  return {
    grossSalary,
    totalDeductions,
    employerContribution,
    netSalary,
    monthlyCtc,
    annualCtc: round(monthlyCtc * 12),
    costToCompany: Math.max(0, round(netSalary + totalDeductions + employerContribution)),
    bonus,
    totalAmount: Math.max(0, round(netSalary + bonus)),

    // Kept so nothing that already read these keys breaks.
    employerCost: employerContribution,
    ctcMonthly: monthlyCtc,
  };
};

/**
 * Empty strings are stripped before submit.
 *
 * Sending `""` for an optional enum or date fails server validation, and
 * sending it for a masked field would overwrite real data with a blank -- the
 * classic way an edit form quietly destroys what it was not showing.
 */
const clean = (value) => {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const result = Object.fromEntries(
      Object.entries(value)
        .map(([key, inner]) => [key, clean(inner)])
        .filter(([, inner]) => inner !== undefined),
    );
    return Object.keys(result).length ? result : undefined;
  }
  return value === '' || value === null ? undefined : value;
};

const EmployeeFormPage = () => {
  const { id } = useParams();
  const isEdit = Boolean(id);

  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const { current, masters, saving, error, status } = useAppSelector(selectEmployees);

  const [tab, setTab] = useState(0);
  const [form, setForm] = useState(EMPTY);
  // Held only long enough to show it. The server cannot produce it a second time.
  const [generatedPassword, setGeneratedPassword] = useState(null);

  useEffect(() => {
    dispatch(fetchMasters());
    if (isEdit) dispatch(fetchEmployee(id));
    return () => dispatch(clearCurrent());
  }, [dispatch, id, isEdit]);

  useEffect(() => {
    if (isEdit && current) setForm(toFormState(current));
  }, [isEdit, current]);

  /** Field-level messages from the API, keyed by path, for inline display. */
  const fieldErrors = useMemo(() => {
    const map = {};
    (error?.details ?? []).forEach((detail) => {
      if (detail.field) map[detail.field] = detail.message;
    });
    return map;
  }, [error]);

  const set = (path) => (event) => {
    const { value } = event.target;
    setForm((previous) => {
      const segments = path.split('.');
      if (segments.length === 1) return { ...previous, [path]: value };
      const [group, field] = segments;
      return { ...previous, [group]: { ...previous[group], [field]: value } };
    });
  };

  /**
   * Overtime eligibility drives both the section's visibility and the legacy
   * top-level flag, so they are set together and cannot drift apart.
   */
  const setOvertimeEligible = (event) => {
    const { checked } = event.target;
    setForm((previous) => ({
      ...previous,
      overtimeEligible: checked,
      overtime: { ...previous.overtime, eligible: checked },
    }));
  };

  /**
   * Turning portal access on seeds the login email from the work email.
   *
   * Only when the field is still empty: an administrator who typed a different
   * address -- some people sign in with a personal one -- must not have it
   * overwritten by toggling the section closed and open again.
   */
  const setPortalAccess = (event) => {
    const { checked } = event.target;

    setForm((previous) => ({
      ...previous,
      portalAccess: checked,
      portalEmail: checked && !previous.portalEmail ? (previous.workEmail ?? '') : previous.portalEmail,
    }));
  };

  /** Checkbox/switch handler. Kept separate because the value is `checked`. */
  const setFlag = (path) => (event) => {
    const { checked } = event.target;
    setForm((previous) => {
      const segments = path.split('.');
      if (segments.length === 1) return { ...previous, [path]: checked };
      const [group, field] = segments;
      return { ...previous, [group]: { ...previous[group], [field]: checked } };
    });
  };

  /**
   * Copies the current address into the permanent one while the box is ticked.
   *
   * Applied on toggle rather than on every keystroke so the permanent address
   * stays independently editable once un-ticked -- the user's earlier entry is
   * not silently overwritten.
   */
  const setSameAsCurrent = (event) => {
    const { checked } = event.target;
    setForm((previous) => ({
      ...previous,
      sameAsCurrentAddress: checked,
      permanentAddress: checked ? { ...previous.currentAddress } : previous.permanentAddress,
    }));
  };

  /**
   * Applies a salary template.
   *
   * Fills the components from the template's percentages and its statutory
   * defaults, leaving every field editable afterwards -- the template is a
   * starting point, not a lock. Requires a gross to work from, so it uses the
   * gross already entered, or derives one from the annual CTC.
   *
   * BASIC IS SOLVED FOR, not taken as a percentage of gross. Every template
   * percentage is expressed against basic -- the Tanzanian convention -- so
   * the split has to be inverted: the fixed shilling allowances come off the
   * gross first, and what is left is divided by one plus the percentages that
   * ride on basic. That is what makes the components total the gross exactly,
   * without a residual component existing purely to absorb the difference.
   */
  const applySalaryTemplate = (templateId) => {
    const template = masters.salaryTemplates?.find((entry) => entry._id === templateId);

    setForm((previous) => {
      if (!template) return { ...previous, salaryTemplateId: templateId };

      const statutory = {
        ...previous.statutory,
        nssfApplicable: template.nssfApplicable,
        nhifApplicable: template.nhifApplicable,
        payeApplicable: template.payeApplicable,
      };

      const currentGross = calculateTotals(previous.salaryStructure).grossSalary;
      const gross = currentGross || Math.round(toNumber(previous.salaryStructure.ctc) / 12);

      // Nothing to apportion yet -- carry the statutory defaults only.
      if (!gross) return { ...previous, salaryTemplateId: templateId, statutory };

      const food = toNumber(template.foodAllowanceAmount);
      const mediclaim = toNumber(template.mediclaimAmount);
      const schoolFees = toNumber(template.schoolFeesAllowanceAmount);

      const remaining = Math.max(0, gross - food - mediclaim - schoolFees);

      const hraPercent = toNumber(template.hraPercent);
      const transportPercent = toNumber(template.transportationPercent);
      const commsPercent = toNumber(template.communicationPercent);
      const leavePercent = toNumber(template.annualLeavePercent);

      // The annual leave allowance is stated per annum, so its share of a
      // month's basic is a twelfth of the percentage.
      const multiplier =
        1 + hraPercent / 100 + transportPercent / 100 + commsPercent / 100 + leavePercent / 100 / 12;

      const basic = Math.round(remaining / (multiplier || 1));

      return {
        ...previous,
        salaryTemplateId: templateId,
        salaryStructure: {
          ...previous.salaryStructure,
          basic,
          hraAllowance: Math.round((basic * hraPercent) / 100),
          foodAllowance: food,
          transportationAllowance: Math.round((basic * transportPercent) / 100),
          communicationAllowance: Math.round((basic * commsPercent) / 100),
          mediclaim,
          schoolFeesAllowance: schoolFees,
          annualLeaveAllowance: Math.round((basic * leavePercent) / 100 / 12),
        },
        statutory,
      };
    });
  };

  const setContact = (field) => (event) => {
    const { value } = event.target;
    setForm((previous) => {
      const contacts = [...previous.emergencyContacts];
      contacts[0] = { ...contacts[0], [field]: value };
      return { ...previous, emergencyContacts: contacts };
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const payload = clean({
      ...form,
      // The form edits "HH:MM"; the API stores minutes.
      standardDutyMinutes: dutyToMinutes(form.standardDutyHours),
      standardDutyHours: undefined,
      // A contact row with no name is an untouched placeholder, not data.
      emergencyContacts: form.emergencyContacts.filter((contact) => contact.name?.trim()),
      // Ticked at save time means the two addresses must match, whatever was
      // typed into the permanent fields before the box was ticked.
      permanentAddress: form.sameAsCurrentAddress ? form.currentAddress : form.permanentAddress,
    });

    try {
      const saved = await dispatch(saveEmployee({ id, payload })).unwrap();

      /**
       * A generated password is shown before leaving the page.
       *
       * The server returns it exactly once -- it is stored only as a hash and
       * cannot be read back -- so navigating straight to the detail page would
       * lose the only copy and leave an account nobody can sign into.
       */
      if (saved.portalGeneratedPassword) {
        setGeneratedPassword({ password: saved.portalGeneratedPassword, employee: saved });
        return;
      }

      // Resolved through the shared rule so the redirect works whether the
      // response was serialised with virtuals or not.
      navigate(PATHS.employeeDetail(getRowId(saved)));
    } catch {
      // Rejection is already in slice state; surface the first failing tab.
      setTab(0);
    }
  };

  const field = (label, path, extra = {}) => (
    <TextField
      label={label}
      value={path.split('.').reduce((accumulator, key) => accumulator?.[key], form) ?? ''}
      onChange={set(path)}
      error={Boolean(fieldErrors[path])}
      helperText={fieldErrors[path]}
      {...extra}
    />
  );

  const dateField = (label, path, extra = {}) =>
    field(label, path, { type: 'date', slotProps: { inputLabel: { shrink: true } }, ...extra });

  const selectField = (label, path, options, extra = {}) =>
    field(label, path, {
      select: true,
      ...extra,
      children: [
        <MenuItem key="__none" value="">
          <em>Not set</em>
        </MenuItem>,
        ...options.map((option) => (
          <MenuItem key={option.value ?? option._id} value={option.value ?? option._id}>
            {option.label ?? option.name}
          </MenuItem>
        )),
      ],
    });

  const half = { xs: 12, sm: 6, md: 4 };
  // Salary inputs sit four-up on a wide screen so a full structure is visible
  // without scrolling, and stack cleanly on tablet and phone.
  const quarter = { xs: 12, sm: 6, md: 3 };

  const totals = calculateTotals(form.salaryStructure);

  /** Whether a login account exists on the server, whatever the toggle says. */
  const hasAccount = Boolean(current?.userId);

  /**
   * The work email and the login email have diverged.
   *
   * Only worth raising once both are set and portal access is on -- an empty
   * login email simply defaults to the work one on save.
   */
  const emailDrift =
    form.portalAccess &&
    Boolean(form.workEmail) &&
    Boolean(form.portalEmail) &&
    form.workEmail.trim().toLowerCase() !== form.portalEmail.trim().toLowerCase();

  /**
   * Live overtime rate, mirroring `deriveOvertimeRate` on the server.
   *
   * Read-only feedback while editing; the server recomputes and stores the
   * authoritative figures on save, and the payroll run recomputes them again
   * for the month it is paying.
   *
   * The divisor is the month's own length, so this preview names the month it
   * priced -- otherwise a figure that changes on the first of September looks
   * like a bug rather than the point.
   */
  const overtimeTotals = useMemo(() => {
    const config = form.overtime ?? {};
    if (!config.eligible) {
      return { hourlySalary: 0, overtimeRate: 0, explanation: '' };
    }

    const now = new Date();
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    // `en-TZ` first, `en-GB` behind it -- not every browser ships Tanzanian
    // locale data, and an unrecognised locale falls back to the reader's own.
    const monthName = now.toLocaleDateString(['en-TZ', 'en-GB'], { month: 'long', year: 'numeric' });

    // An employee with their own monthly hours keeps them; everyone else is
    // priced on the month. Matches workingHoursFor() on the server.
    const hours = toNumber(config.workingHoursPerMonth) || days * STANDARD_DAILY_WORKING_HOURS;
    const companyMultiplier = masters.payrollDefaults?.overtimeMultiplier ?? 2;

    const multiplier =
      config.calculationMethod === 'COMPANY_POLICY'
        ? companyMultiplier
        : config.multiplier === 'CUSTOM'
          ? toNumber(config.customMultiplier) || 1
          : toNumber(config.multiplier) || 1;

    // Rounded before it is multiplied, exactly as the server does, so the
    // rate on screen is the product of the two numbers shown beside it.
    const hourlySalary =
      config.calculationMethod === 'FIXED_HOURLY_RATE'
        ? round2(toNumber(config.fixedHourlyRate))
        : hours
          ? round2(totals.grossSalary / hours)
          : 0;

    const divisor = toNumber(config.workingHoursPerMonth)
      ? `${hours} hrs`
      : `(${days} × ${STANDARD_DAILY_WORKING_HOURS} hrs) = ${hours} hrs`;

    const explanation =
      config.calculationMethod === 'FIXED_HOURLY_RATE'
        ? `Fixed ${formatCurrency(hourlySalary)} × ${multiplier}x = ${formatCurrency(round2(hourlySalary * multiplier))} per overtime hour`
        : `${monthName}: ${formatCurrency(totals.grossSalary)} ÷ ${divisor} = ${formatCurrency(hourlySalary)} × ${multiplier}x = ${formatCurrency(round2(hourlySalary * multiplier))} per overtime hour`;

    return {
      hourlySalary,
      overtimeRate: round2(hourlySalary * multiplier),
      explanation,
    };
  }, [form.overtime, totals.grossSalary, masters.payrollDefaults]);

  /** Currency input with the shilling adornment, right-aligned like a ledger. */
  const moneyField = (label, path, extra = {}) =>
    field(label, path, {
      type: 'number',
      slotProps: {
        input: {
          startAdornment: <CurrencyAdornment />,
          inputProps: { min: 0, step: 1, style: { textAlign: 'right' } },
        },
      },
      ...extra,
    });

  /** Read-only derived total. Visually distinct so it is clearly not editable. */
  const totalField = (label, value, emphasis = false) => (
    <TextField
      label={label}
      value={formatCurrency(value)}
      slotProps={{ input: { readOnly: true } }}
      helperText="Calculated"
      sx={{
        '& .MuiInputBase-input': {
          textAlign: 'right',
          fontWeight: emphasis ? 700 : 500,
          color: emphasis ? 'primary.main' : 'text.primary',
        },
        '& .MuiInputBase-root': { bgcolor: 'action.hover' },
      }}
    />
  );

  if (isEdit && status === 'loading' && !current) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 320 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box component="form" onSubmit={handleSubmit} noValidate>
      <PageHeader
        title={isEdit ? `Edit ${current?.employeeCode ?? 'employee'}` : 'Add employee'}
        subtitle={isEdit ? current?.fullName : 'Create a new employee master record'}
        breadcrumbs={[
          { label: 'Home', to: PATHS.dashboard },
          { label: 'Employees', to: PATHS.employees },
          { label: isEdit ? 'Edit' : 'New' },
        ]}
        actions={
          <>
            <Button color="inherit" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      />

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error.message}
          {error.details?.length > 0 && (
            <Box component="ul" sx={{ m: 0, mt: 1, pl: 2 }}>
              {error.details.slice(0, 6).map((detail) => (
                <li key={`${detail.field}-${detail.message}`}>
                  <Typography variant="caption">
                    {detail.field}: {detail.message}
                  </Typography>
                </li>
              ))}
            </Box>
          )}
        </Alert>
      )}

      <Paper variant="outlined">
        <Tabs
          value={tab}
          onChange={(_event, next) => setTab(next)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}
        >
          {TABS.map((label) => (
            <Tab key={label} label={label} />
          ))}
        </Tabs>

        <Box sx={{ p: 3 }}>
          {tab === 0 && (
            <Grid container spacing={2}>
              <Grid size={half}>{field('First name', 'firstName', { required: true })}</Grid>
              <Grid size={half}>{field('Middle name', 'middleName')}</Grid>
              <Grid size={half}>{field('Last name', 'lastName')}</Grid>
              <Grid size={half}>{field("Father's name", 'fatherName')}</Grid>
              <Grid size={half}>{field("Mother's name", 'motherName')}</Grid>
              <Grid size={half}>{selectField('Gender', 'gender', GENDER_OPTIONS)}</Grid>
              <Grid size={half}>{dateField('Date of birth', 'dateOfBirth')}</Grid>
              <Grid size={half}>{selectField('Blood group', 'bloodGroup', BLOOD_GROUP_OPTIONS)}</Grid>
              <Grid size={half}>
                {selectField('Marital status', 'maritalStatus', MARITAL_STATUS_OPTIONS)}
              </Grid>
              <Grid size={half}>{field('Personal email', 'personalEmail', { type: 'email' })}</Grid>
              <Grid size={half}>{field('Mobile', 'mobile')}</Grid>
              <Grid size={half}>{field('Alternate mobile', 'alternateMobile')}</Grid>
            </Grid>
          )}

          {tab === 1 && (
            <Grid container spacing={2}>
              <Grid size={half}>
                {/*
                  Read-only in both modes. The server issues the ID on save and
                  will not accept a change to it afterwards, so an editable box
                  could only ever collect a value that is silently discarded.
                */}
                {field('Employee ID', 'employeeId', {
                  slotProps: { input: { readOnly: true } },
                  placeholder: isEdit ? '' : 'Generated on save',
                  helperText:
                    fieldErrors.employeeId ??
                    (isEdit
                      ? 'Permanent — issued when the employee was created'
                      : 'Generated automatically when the employee is saved'),
                })}
              </Grid>
              <Grid size={half}>{field('Official email', 'workEmail', { type: 'email' })}</Grid>
              <Grid size={half}>{selectField('Unit / Plant', 'unitId', masters.units)}</Grid>

              <Grid size={half}>{dateField('Joining date', 'joiningDate', { required: true })}</Grid>
              <Grid size={half}>{dateField('Confirmation date', 'confirmationDate')}</Grid>
              <Grid size={half}>
                {field('Probation period (months)', 'probationMonths', {
                  type: 'number',
                  slotProps: { input: { inputProps: { min: 0, max: 24 } } },
                })}
              </Grid>

              <Grid size={half}>{selectField('Department', 'departmentId', masters.departments)}</Grid>
              <Grid size={half}>{selectField('Designation', 'designationId', masters.designations)}</Grid>
              <Grid size={half}>{selectField('Shift', 'shiftId', masters.shifts)}</Grid>

              <Grid size={half}>
                {selectField(
                  'Reporting manager',
                  'reportingManagerId',
                  // Labelled with the code so two people of the same name are
                  // still distinguishable.
                  (masters.reportingManagers ?? []).map((manager) => ({
                    _id: manager._id,
                    name: `${employeeIdentifiers(manager)} — ${[manager.firstName, manager.lastName].filter(Boolean).join(' ')}`,
                  })),
                )}
              </Grid>
              <Grid size={half}>
                {selectField('Employee category', 'employeeCategory', EMPLOYEE_CATEGORY_OPTIONS)}
              </Grid>
              <Grid size={half}>
                {selectField('Employment type', 'employmentType', EMPLOYMENT_TYPE_OPTIONS)}
              </Grid>

              <Grid size={half}>{selectField('Grade', 'gradeId', masters.grades)}</Grid>
              <Grid size={half}>{field('Work location', 'workLocation')}</Grid>
              <Grid size={half}>
                {selectField('Employee status', 'status', EMPLOYEE_STATUS_OPTIONS, {
                  disabled: true,
                  helperText: 'Changed from the profile, so the lifecycle rules apply',
                })}
              </Grid>

              <Grid size={half}>
                {field('Standard duty hours', 'standardDutyHours', {
                  type: 'time',
                  slotProps: { inputLabel: { shrink: true } },
                  helperText: 'A full working day for this employee. Anything worked beyond it is overtime.',
                })}
              </Grid>

              <Grid size={12}>
                <FormControlLabel
                  control={
                    <Switch checked={Boolean(form.overtimeEligible)} onChange={setFlag('overtimeEligible')} />
                  }
                  label="Eligible for overtime"
                />
              </Grid>

              {/* ------------------------------------------ Portal access -- */}
              <Grid size={12}>
                <Divider textAlign="left" sx={{ my: 1 }}>
                  <Typography variant="overline" color="text.secondary">
                    Portal access
                  </Typography>
                </Divider>
              </Grid>

              <Grid size={12}>
                <FormControlLabel
                  control={
                    <Switch checked={Boolean(form.portalAccess)} onChange={setPortalAccess} />
                  }
                  label="Enable portal login"
                />
                <Typography variant="caption" color="text.secondary" display="block">
                  {form.portalAccess
                    ? 'This employee can sign in to the HRMS with the email below.'
                    : hasAccount
                      ? 'Saving with this off will deactivate the login account. It is never deleted — the audit trail refers to it.'
                      : 'Off means HR data only, with no way to sign in.'}
                </Typography>
              </Grid>

              {form.portalAccess && (
                <>
                  <Grid size={half}>
                    {field('Login email', 'portalEmail', {
                      required: true,
                      type: 'email',
                      helperText:
                        fieldErrors.portalEmail ?? 'Defaults to the work email; editable if they sign in with another.',
                    })}
                  </Grid>

                  <Grid size={half}>
                    {selectField('Role', 'portalRole', PORTAL_ROLE_OPTIONS, {
                      required: true,
                      helperText:
                        fieldErrors.portalRole ?? 'What they may see and do. Super Admin is not granted from here.',
                    })}
                  </Grid>

                  <Grid size={half}>
                    {field('Password', 'portalPassword', {
                      type: 'password',
                      autoComplete: 'new-password',
                      helperText:
                        fieldErrors.portalPassword ??
                        (hasAccount
                          ? 'Leave blank to keep the current password. Setting one signs them out everywhere.'
                          : 'Leave blank to generate one — it is shown once when you save.'),
                    })}
                  </Grid>

                  <Grid size={half}>
                    {selectField('Account status', 'portalStatus', PORTAL_STATUS_OPTIONS, {
                      helperText: fieldErrors.portalStatus ?? 'Suspending signs them out immediately.',
                    })}
                  </Grid>

                  {/*
                    The work email moved but the login did not. Raised rather
                    than fixed silently: which address someone signs in with is
                    a decision, and quietly changing a credential is not ours to
                    make.
                  */}
                  {emailDrift && (
                    <Grid size={12}>
                      <Alert
                        severity="warning"
                        variant="outlined"
                        action={
                          <Button
                            size="small"
                            color="inherit"
                            onClick={() =>
                              setForm((previous) => ({ ...previous, portalEmail: previous.workEmail }))
                            }
                          >
                            Use work email
                          </Button>
                        }
                      >
                        The work email is <strong>{form.workEmail}</strong> but the login email is{' '}
                        <strong>{form.portalEmail}</strong>. They sign in with the login email.
                      </Alert>
                    </Grid>
                  )}

                  {hasAccount && (
                    <Grid size={12}>
                      <Alert severity="info" variant="outlined">
                        This employee has a login account.
                        {current?.userId?.lastLoginAt
                          ? ` Last sign-in ${formatDate(current.userId.lastLoginAt, 'dd MMM yyyy, HH:mm')}.`
                          : ' They have never signed in.'}
                        {current?.userId?.isEmailVerified === false && ' Their email is not verified.'}
                      </Alert>
                    </Grid>
                  )}
                </>
              )}
            </Grid>
          )}

          {tab === 2 && (
            <Grid container spacing={2}>
              <Grid size={12}>
                <Divider textAlign="left" sx={{ mb: 1 }}>
                  <Typography variant="overline" color="text.secondary">
                    Identity
                  </Typography>
                </Divider>
              </Grid>

              <Grid size={half}>
                {field('National ID (NIDA)', 'statutory.nationalIdNumber', {
                  helperText: fieldErrors['statutory.nationalIdNumber'] ?? 'As printed on the NIDA card',
                })}
              </Grid>
              <Grid size={half}>
                {field('TIN', 'statutory.tinNumber', {
                  helperText: fieldErrors['statutory.tinNumber'] ?? 'e.g. 123-456-789',
                })}
              </Grid>
              <Grid size={half}>{field('Passport number', 'statutory.passportNumber')}</Grid>
              <Grid size={half}>{field('Driving license', 'statutory.drivingLicense')}</Grid>
              <Grid size={half}>
                {field('Work permit number', 'statutory.workPermitNumber', {
                  helperText: 'Expatriate employees only — leave blank for citizens',
                })}
              </Grid>

              <Grid size={12}>
                <Divider textAlign="left" sx={{ my: 1 }}>
                  <Typography variant="overline" color="text.secondary">
                    Statutory schemes
                  </Typography>
                </Divider>
              </Grid>

              <Grid size={12}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0, sm: 3 }} flexWrap="wrap">
                  <FormControlLabel
                    control={
                      <Switch
                        checked={Boolean(form.statutory.nssfApplicable)}
                        onChange={setFlag('statutory.nssfApplicable')}
                      />
                    }
                    label="NSSF applicable"
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={Boolean(form.statutory.nhifApplicable)}
                        onChange={setFlag('statutory.nhifApplicable')}
                      />
                    }
                    label="NHIF applicable"
                  />
                  <FormControlLabel
                    control={
                      <Switch
                        checked={Boolean(form.statutory.payeApplicable)}
                        onChange={setFlag('statutory.payeApplicable')}
                      />
                    }
                    label="PAYE applicable"
                  />
                </Stack>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                  SDL and WCF are levied on the employer&apos;s payroll and have no per-employee switch —
                  they are never deducted from anybody&apos;s pay.
                </Typography>
              </Grid>

              {/* Numbers are only asked for when the scheme applies -- an
                  inapplicable field invites a value that means nothing. */}
              {form.statutory.nssfApplicable && (
                <Grid size={half}>{field('NSSF number', 'statutory.nssfNumber')}</Grid>
              )}
              {form.statutory.nhifApplicable && (
                <Grid size={half}>{field('NHIF number', 'statutory.nhifNumber')}</Grid>
              )}
            </Grid>
          )}

          {/* ------------------------------------------------- Salary ---- */}
          {tab === 3 && (
            <Grid container spacing={2}>
              <Grid size={half}>
                <TextField
                  select
                  label="Salary structure template"
                  value={form.salaryTemplateId ?? ''}
                  onChange={(event) => applySalaryTemplate(event.target.value)}
                  helperText="Prefills the components below; every figure stays editable"
                >
                  <MenuItem value="">
                    <em>None</em>
                  </MenuItem>
                  {(masters.salaryTemplates ?? []).map((template) => (
                    <MenuItem key={template._id} value={template._id}>
                      {template.name}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid size={half}>{field('CTC (annual)', 'salaryStructure.ctc', { type: 'number' })}</Grid>
              <Grid size={half}>{field('Band', 'salaryStructure.band')}</Grid>

              <Grid size={12}>
                <Divider textAlign="left" sx={{ my: 1 }}>
                  <Typography variant="overline" color="text.secondary">
                    Earnings (monthly)
                  </Typography>
                </Divider>
              </Grid>

              {SALARY_EARNING_FIELDS.map((component) => (
                <Grid size={quarter} key={component.key}>
                  {/* `help` explains a component whose stored figure is not
                      what its name implies -- the annual leave allowance is
                      entered monthly. */}
                  {moneyField(component.label, `salaryStructure.${component.key}`, {
                    helperText:
                      fieldErrors[`salaryStructure.${component.key}`] ?? component.help,
                  })}
                </Grid>
              ))}

              <Grid size={12}>
                <Divider textAlign="left" sx={{ my: 1 }}>
                  <Typography variant="overline" color="text.secondary">
                    Deductions (from employee)
                  </Typography>
                </Divider>
              </Grid>

              {SALARY_DEDUCTION_FIELDS.map((component) => (
                <Grid size={quarter} key={component.key}>
                  {moneyField(component.label, `salaryStructure.${component.key}`)}
                </Grid>
              ))}

              <Grid size={12}>
                <Divider textAlign="left" sx={{ my: 1 }}>
                  <Typography variant="overline" color="text.secondary">
                    Employer contributions (cost to company, not deducted)
                  </Typography>
                </Divider>
              </Grid>

              {SALARY_EMPLOYER_FIELDS.map((component) => (
                <Grid size={quarter} key={component.key}>
                  {moneyField(component.label, `salaryStructure.${component.key}`)}
                </Grid>
              ))}

              <Grid size={12}>
                <Divider sx={{ my: 1 }} />
              </Grid>

              {/*
                The eight summary figures, in the order the payroll policy
                states them. All read-only and calculated -- no input field was
                added, renamed or removed.
              */}
              <Grid size={quarter}>{totalField('Gross salary', totals.grossSalary)}</Grid>
              <Grid size={quarter}>{totalField('Employee deductions', totals.totalDeductions)}</Grid>
              <Grid size={quarter}>{totalField('Employer contribution', totals.employerContribution)}</Grid>
              <Grid size={quarter}>{totalField('Net salary', totals.netSalary, true)}</Grid>

              <Grid size={quarter}>{totalField('Monthly CTC', totals.monthlyCtc)}</Grid>
              <Grid size={quarter}>{totalField('Annual CTC', totals.annualCtc)}</Grid>
              <Grid size={quarter}>{totalField('Cost to company', totals.costToCompany)}</Grid>
              <Grid size={quarter}>{totalField('Total amount', totals.totalAmount, true)}</Grid>

              <Grid size={12}>
                <Alert severity="info" variant="outlined">
                  Every total recalculates as you type and is recomputed on the server when you save. Gross is the
                  earnings above, undiminished; net salary is gross less the employee&apos;s NSSF, NHIF and PAYE.
                  The employer&apos;s NSSF, SDL and WCF are a cost the company carries <strong>on top</strong> of
                  the salary and are never deducted — they appear in cost to company instead.
                </Alert>
              </Grid>

              {/* ------------------------------- Overtime configuration -- */}
              <Grid size={12}>
                <Divider textAlign="left" sx={{ my: 2 }}>
                  <Typography variant="overline" color="text.secondary">
                    Overtime configuration
                  </Typography>
                </Divider>
              </Grid>

              <Grid size={12}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={Boolean(form.overtime.eligible)}
                      onChange={setOvertimeEligible}
                    />
                  }
                  label="Overtime eligible"
                />
                <Typography variant="caption" color="text.secondary" display="block">
                  Attendance records hours worked past the shift either way. This decides
                  whether payroll pays for them.
                </Typography>
              </Grid>

              {/* Every setting is hidden while ineligible: showing rules that
                  will never apply invites values nobody intends to use. */}
              {form.overtime.eligible && (
                <>
                  <Grid size={half}>
                    {selectField(
                      'Calculation method',
                      'overtime.calculationMethod',
                      OVERTIME_METHOD_OPTIONS,
                      {
                        helperText: OVERTIME_METHOD_OPTIONS.find(
                          (option) => option.value === form.overtime.calculationMethod,
                        )?.help,
                      },
                    )}
                  </Grid>

                  {form.overtime.calculationMethod === 'FIXED_HOURLY_RATE' ? (
                    <Grid size={half}>
                      {moneyField('Fixed hourly rate', 'overtime.fixedHourlyRate', {
                        required: true,
                        helperText:
                          fieldErrors['overtime.fixedHourlyRate'] ??
                          'Paid per overtime hour, before any premium',
                      })}
                    </Grid>
                  ) : (
                    <Grid size={half}>
                      {field('Working hours per month', 'overtime.workingHoursPerMonth', {
                        type: 'number',
                        helperText:
                          'Leave blank to use the payroll month’s own length × 8 hrs. Set it only for someone who does not work a standard month.',
                      })}
                    </Grid>
                  )}

                  <Grid size={half}>
                    {selectField('Overtime multiplier', 'overtime.multiplier', OVERTIME_MULTIPLIER_OPTIONS, {
                      disabled: form.overtime.calculationMethod === 'COMPANY_POLICY',
                      helperText:
                        form.overtime.calculationMethod === 'COMPANY_POLICY'
                          ? 'Company policy supplies the multiplier'
                          : 'Applied to the hourly rate for normal overtime',
                    })}
                  </Grid>

                  {/* Shown only when Custom is chosen, per the spec. */}
                  {form.overtime.multiplier === 'CUSTOM' &&
                    form.overtime.calculationMethod !== 'COMPANY_POLICY' && (
                      <Grid size={half}>
                        {field('Custom multiplier', 'overtime.customMultiplier', {
                          type: 'number',
                          required: true,
                          slotProps: { input: { inputProps: { min: 1, max: 10, step: 0.05 } } },
                          helperText: fieldErrors['overtime.customMultiplier'] ?? 'For example 1.8 or 2.2',
                        })}
                      </Grid>
                    )}

                  <Grid size={quarter}>{totalField('Hourly salary', overtimeTotals.hourlySalary)}</Grid>
                  <Grid size={quarter}>
                    {totalField('Overtime rate / hour', overtimeTotals.overtimeRate, true)}
                  </Grid>

                  <Grid size={12}>
                    <Typography variant="caption" color="text.secondary">
                      {overtimeTotals.explanation}
                    </Typography>
                  </Grid>

                  <Grid size={half}>
                    {field('Max overtime per day (hours)', 'overtime.maxDailyOT', {
                      type: 'number',
                      slotProps: { input: { inputProps: { min: 0, max: 24, step: 0.5 } } },
                      helperText:
                        fieldErrors['overtime.maxDailyOT'] ?? 'Attendance will not record more than this',
                    })}
                  </Grid>
                  <Grid size={half}>
                    {field('Max overtime per month (hours)', 'overtime.maxMonthlyOT', {
                      type: 'number',
                      slotProps: { input: { inputProps: { min: 0, max: 400 } } },
                      helperText: fieldErrors['overtime.maxMonthlyOT'] ?? 'Statutory or policy ceiling',
                    })}
                  </Grid>

                  <Grid size={12}>
                    <Typography variant="overline" color="text.secondary">
                      Premium rates
                    </Typography>
                  </Grid>

                  {OVERTIME_PREMIUM_FIELDS.map((premium) => (
                    <Fragment key={premium.key}>
                      <Grid size={half}>
                        {selectField(premium.label, `overtime.${premium.key}`, PREMIUM_MULTIPLIER_OPTIONS, {
                          helperText: premium.help,
                        })}
                      </Grid>
                      {form.overtime[premium.key] === 'CUSTOM' && (
                        <Grid size={half}>
                          {field(`${premium.label} — custom`, `overtime.${premium.customKey}`, {
                            type: 'number',
                            required: true,
                            slotProps: { input: { inputProps: { min: 1, max: 10, step: 0.05 } } },
                            helperText: fieldErrors[`overtime.${premium.customKey}`],
                          })}
                        </Grid>
                      )}
                    </Fragment>
                  ))}
                </>
              )}
            </Grid>
          )}

          {/* ------------------------------------ Bank & Emergency ------ */}
          {tab === 4 && (
            <Grid container spacing={2}>
              <Grid size={half}>{field('Account holder', 'bankDetails.accountHolderName')}</Grid>
              <Grid size={half}>{field('Account number', 'bankDetails.accountNumber')}</Grid>
              <Grid size={half}>
                {field('SWIFT code', 'bankDetails.swiftCode', {
                  helperText:
                    fieldErrors['bankDetails.swiftCode'] ??
                    'Required alongside an account number — e.g. CORUTZTZ',
                })}
              </Grid>
              <Grid size={half}>{field('Bank name', 'bankDetails.bankName')}</Grid>
              <Grid size={half}>{field('Branch', 'bankDetails.branch')}</Grid>
              <Grid size={half}>
                {field('Branch code', 'bankDetails.branchCode', {
                  helperText: "The bank's own branch code, where it quotes one",
                })}
              </Grid>
              <Grid size={half}>
                {selectField('Account type', 'bankDetails.accountType', BANK_ACCOUNT_TYPE_OPTIONS)}
              </Grid>

              <Grid size={12}>
                <Divider textAlign="left" sx={{ my: 1 }}>
                  <Typography variant="overline" color="text.secondary">
                    Emergency contact
                  </Typography>
                </Divider>
              </Grid>

              <Grid size={half}>
                <TextField
                  label="Contact name"
                  value={form.emergencyContacts[0]?.name ?? ''}
                  onChange={setContact('name')}
                />
              </Grid>
              <Grid size={half}>
                <TextField
                  label="Relationship"
                  value={form.emergencyContacts[0]?.relationship ?? ''}
                  onChange={setContact('relationship')}
                />
              </Grid>
              <Grid size={half}>
                <TextField
                  label="Primary contact number"
                  value={form.emergencyContacts[0]?.phone ?? ''}
                  onChange={setContact('phone')}
                />
              </Grid>
              <Grid size={half}>
                <TextField
                  label="Secondary contact number"
                  value={form.emergencyContacts[0]?.alternatePhone ?? ''}
                  onChange={setContact('alternatePhone')}
                />
              </Grid>
            </Grid>
          )}

          {/* ------------------------------------------------ Address ---- */}
          {tab === 5 && (
            <Grid container spacing={2}>
              <Grid size={12}>
                <Typography variant="overline" color="text.secondary">
                  Current address
                </Typography>
              </Grid>
              <Grid size={{ xs: 12, md: 8 }}>{field('Address line 1', 'currentAddress.line1')}</Grid>
              <Grid size={{ xs: 12, md: 4 }}>{field('Address line 2', 'currentAddress.line2')}</Grid>
              <Grid size={half}>{field('City', 'currentAddress.city')}</Grid>
              <Grid size={half}>{field('State', 'currentAddress.state')}</Grid>
              <Grid size={half}>{field('Postal code', 'currentAddress.postalCode')}</Grid>
              <Grid size={half}>{field('Country', 'currentAddress.country')}</Grid>

              <Grid size={12}>
                <Divider sx={{ my: 1 }} />
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  alignItems={{ sm: 'center' }}
                  justifyContent="space-between"
                >
                  <Typography variant="overline" color="text.secondary">
                    Permanent address
                  </Typography>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={Boolean(form.sameAsCurrentAddress)}
                        onChange={setSameAsCurrent}
                      />
                    }
                    label="Same as current address"
                  />
                </Stack>
              </Grid>

              {/* Disabled rather than hidden while mirrored: the values stay
                  visible, so it is obvious what will be saved. */}
              <Grid size={{ xs: 12, md: 8 }}>
                {field('Address line 1', 'permanentAddress.line1', {
                  disabled: form.sameAsCurrentAddress,
                })}
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                {field('Address line 2', 'permanentAddress.line2', {
                  disabled: form.sameAsCurrentAddress,
                })}
              </Grid>
              <Grid size={half}>
                {field('City', 'permanentAddress.city', { disabled: form.sameAsCurrentAddress })}
              </Grid>
              <Grid size={half}>
                {field('State', 'permanentAddress.state', { disabled: form.sameAsCurrentAddress })}
              </Grid>
              <Grid size={half}>
                {field('Postal code', 'permanentAddress.postalCode', {
                  disabled: form.sameAsCurrentAddress,
                })}
              </Grid>
              <Grid size={half}>
                {field('Country', 'permanentAddress.country', { disabled: form.sameAsCurrentAddress })}
              </Grid>
            </Grid>
          )}

          {/* --------------------------------------------- Additional ---- */}
          {tab === 6 && (
            <Grid container spacing={2}>
              <Grid size={12}>
                {field('Remarks', 'remarks', {
                  multiline: true,
                  minRows: 2,
                  helperText: 'Shown on the employee profile and included in exports',
                })}
              </Grid>
              <Grid size={12}>
                {field('Internal notes', 'notes', {
                  multiline: true,
                  minRows: 5,
                  helperText: 'Longer-form HR commentary. Not exported.',
                })}
              </Grid>

              <Grid size={12}>
                <Alert severity="info" variant="outlined">
                  {isEdit
                    ? 'Photo and documents are managed from the Documents tab.'
                    : 'Save the employee first. The Documents tab opens once the employee code has been assigned.'}
                </Alert>
              </Grid>
            </Grid>
          )}

          {/*
            Documents.

            Rendered outside the form's field grid because it manages its own
            requests: each upload is committed immediately against the saved
            employee, not held until the form is submitted. Files are filed
            under the employee code, which only exists after the first save.
          */}
          {tab === DOCUMENTS_TAB && <EmployeeDocumentsTab employeeId={isEdit ? id : null} />}
        </Box>

        <Divider />

        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ p: 2 }}>
          <Button color="inherit" onClick={() => navigate(-1)}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create employee'}
          </Button>
        </Stack>
      </Paper>

      {/*
        The one and only sight of a generated password.

        Not dismissible by clicking away: closing this by accident loses the
        credential for good, and the account would have to be given a new one.
      */}
      <Dialog open={Boolean(generatedPassword)} maxWidth="xs" fullWidth disableEscapeKeyDown>
        <DialogTitle>Portal access created</DialogTitle>
        <DialogContent dividers>
          <Alert severity="warning" sx={{ mb: 2 }}>
            This password is shown once and cannot be retrieved again. Copy it now and give it to the
            employee.
          </Alert>

          <Typography variant="caption" color="text.secondary" display="block">
            Login email
          </Typography>
          <Typography variant="body2" gutterBottom>
            {generatedPassword?.employee?.userId?.email ?? form.portalEmail ?? form.workEmail}
          </Typography>

          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
            Temporary password
          </Typography>
          <Typography
            variant="h6"
            fontFamily="ui-monospace, monospace"
            sx={{ userSelect: 'all', wordBreak: 'break-all' }}
          >
            {generatedPassword?.password}
          </Typography>

          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>
            They will be asked to change it when they first sign in.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              // Best effort: the clipboard API is unavailable over plain HTTP,
              // which is why the text above is selectable as well.
              navigator.clipboard?.writeText(generatedPassword.password).catch(() => {});
            }}
          >
            Copy
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              const saved = generatedPassword.employee;
              setGeneratedPassword(null);
              navigate(PATHS.employeeDetail(getRowId(saved)));
            }}
          >
            Done
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default EmployeeFormPage;
