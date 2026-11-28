import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

import ApiError from '../../utils/ApiError.js';
import { RESOURCES } from '../../utils/constants.js';
import Employee from '../../models/employee/employee.model.js';
import Unit from '../../models/organization/unit.model.js';
import AppSettings from '../../models/admin/appSettings.model.js';
import BiometricEvent from '../../models/attendance/biometricEvent.model.js';
import { unitAllowed, unitDenied, visibleEmployeeIds } from '../../helpers/unitScope.helper.js';
import { buildTransactionReportPdf } from '../../helpers/transactionReportPdf.helper.js';
import { isPaged, slicePage, withoutPaging } from './attendanceReport.service.js';

/**
 * The Transaction Report: every biometric punch of one unit's employees on one
 * day, exactly as the terminals recorded them.
 *
 * Read straight from the raw punch store (BiometricEvent), which keeps each
 * punch as the device sent it -- one row per punch, the device's own clock
 * text, its work code. Nothing is written and nothing is recomputed; the
 * attendance day records are not consulted at all.
 *
 * A punch belongs to the unit of the employee it is mapped to: the employee it
 * was imported against, or -- for a punch still waiting -- the employee the
 * device's user mapping now names. A punch no mapping names belongs to nobody,
 * and is listed apart as unmapped rather than guessed at.
 */

const here = path.dirname(fileURLToPath(import.meta.url));

/** The East Africa Warehouse logo, used only for the unit whose code is EAW. */
const EAW_LOGO = path.join(here, '..', '..', 'assets', 'reports', 'eaw-logo.png');
const LOGO_BY_UNIT_CODE = { EAW: EAW_LOGO };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

const idOf = (value) => (value ? String(value._id ?? value) : null);
const nameOf = (employee) => [employee.firstName, employee.middleName, employee.lastName].filter(Boolean).join(' ');

/** "2026-11-14 08:22:07" -> "11/14/2026 08:22", the sample's own format. */
const formatPunch = (deviceLocalTime) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(deviceLocalTime ?? '');
  return match ? `${match[2]}/${match[3]}/${match[1]} ${match[4]}:${match[5]}` : (deviceLocalTime ?? '');
};

/** "2026-11-14" -> "11/14/2026". */
const formatDay = (date) => {
  const [year, month, day] = date.split('-');
  return `${month}/${day}/${year}`;
};

/**
 * The punches of `unitId` on `date` (YYYY-MM-DD, the terminals' own date).
 *
 * Unit and date are applied in the database. The date is the device's wall-
 * clock date -- the date printed on the punch -- so the report matches what
 * the terminal shows whatever zone the server runs in; a one-day window on the
 * stored instant keeps the query on the punch-time index.
 */
export const transactionReport = async ({ unitId, date, page, limit }, req) => {
  if (!unitId) throw ApiError.badRequest('Choose a unit');
  if (!date || !DATE_PATTERN.test(date)) throw ApiError.badRequest('Choose a date');
  if (!unitAllowed(req, unitId)) {
    throw unitDenied(req, { requestedUnit: String(unitId) }, 'You do not have access to that unit');
  }

  const tenantId = req.user?.tenantId ?? null;
  const unit = await Unit.findOne({ _id: unitId, tenantId }).select('name code').lean();
  if (!unit) throw ApiError.notFound('Unit not found');

  // The unit's people the caller may see. Leavers included: their punches on
  // a past day are still that day's record.
  const visible = await visibleEmployeeIds(req, RESOURCES.ATTENDANCE);
  const members = await Employee.find({ tenantId, unitId: unit._id, ...(visible ? { _id: { $in: visible } } : {}) })
    .select('employeeCode employeeId firstName middleName lastName')
    .lean();
  const byId = new Map(members.map((employee) => [idOf(employee._id), employee]));
  const byCode = new Map(members.map((employee) => [employee.employeeCode, employee]));

  const settings = await AppSettings.findOne({ tenantId })
    .select('biometricDevices._id biometricDevices.name biometricDevices.userMappings biometricDevices.adms.enrolments')
    .lean();
  const devices = new Map((settings?.biometricDevices ?? []).map((device) => [idOf(device._id), device]));
  const mappingOf = new Map();
  const nameOnDevice = new Map();
  devices.forEach((device, deviceId) => {
    (device.userMappings ?? []).forEach((entry) => mappingOf.set(`${deviceId}|${entry.deviceUserId}`, entry.employeeCode));
    (device.adms?.enrolments ?? []).forEach((entry) => nameOnDevice.set(`${deviceId}|${entry.userId}`, entry.name));
  });

  const [year, month, day] = date.split('-').map(Number);
  const midnight = new Date(year, month - 1, day);

  const events = devices.size
    ? await BiometricEvent.find({
        tenantId,
        deviceId: { $in: [...devices.keys()] },
        punchTime: { $gte: new Date(midnight.getTime() - DAY_MS), $lt: new Date(midnight.getTime() + 2 * DAY_MS) },
        deviceLocalTime: { $regex: `^${date}[ T]` },
      })
        .select('deviceId deviceSerial deviceUserId employeeId employeeCode punchTime deviceLocalTime workCode status')
        .sort({ punchTime: 1, deviceLocalTime: 1, deviceUserId: 1 })
        .lean()
    : [];

  // Devices this unit's people are mapped on: the only devices whose unmapped
  // punches can plausibly be this unit's, and so worth showing beside it.
  const unitDevices = new Set();
  mappingOf.forEach((code, key) => {
    if (byCode.has(code)) unitDevices.add(key.split('|')[0]);
  });

  const rows = [];
  const unmapped = [];

  /**
   * One row per punch as the report prints it. The receiver already drops a
   * record seen twice to the second, but a terminal also stores a finger
   * scanned again within the same minute, and the same punch can arrive under
   * a second registration of one terminal -- rows that print identically. A
   * repeat of employee, terminal, printed date and time, work code and record
   * type is shown once; the events are read earliest first, so the original
   * is the one kept. The stored punches are not touched.
   *
   * The terminal is its serial number where it has one, so one physical
   * terminal registered twice is still one terminal; punches on different
   * terminals, or a minute apart, are never merged.
   */
  const seen = new Set();
  let duplicates = 0;
  const firstTime = (key) => {
    if (seen.has(key)) {
      duplicates += 1;
      return false;
    }
    seen.add(key);
    return true;
  };
  const terminalOf = (event) => (event.deviceSerial ? String(event.deviceSerial).toUpperCase() : idOf(event.deviceId));

  events.forEach((event) => {
    const deviceId = idOf(event.deviceId);
    const mappedCode = mappingOf.get(`${deviceId}|${event.deviceUserId}`) ?? null;
    // Imported against an employee -> that employee; otherwise the current mapping.
    const employee = event.employeeId
      ? byId.get(idOf(event.employeeId)) ?? null
      : (event.employeeCode && byCode.get(event.employeeCode)) || (mappedCode && byCode.get(mappedCode)) || null;

    const common = {
      date: formatPunch(event.deviceLocalTime),
      deviceLocalTime: event.deviceLocalTime,
      // The terminal sends 0 for "no work code", which the receiver stores as empty.
      workCode: event.workCode ?? '0',
      // Every row here is a punch recorded by a terminal, which the sample calls Normal.
      recordType: 'Normal',
      device: devices.get(deviceId)?.name ?? null,
    };

    if (employee) {
      if (!firstTime(`E|${idOf(employee._id)}|${terminalOf(event)}|${common.date}|${common.workCode}|${common.recordType}`)) return;
      rows.push({
        ...common,
        // The "Employee ID" column shows the HRMS Employee Code from the
        // employee master -- never the device user ID, and not the master's
        // separate employeeId field.
        employeeId: employee.employeeCode,
        employeeCode: employee.employeeCode,
        fullName: nameOf(employee),
      });
      return;
    }

    // Mapped to someone -- just not in this unit: another unit's punch.
    if (event.employeeId || event.employeeCode || mappedCode) return;

    if (unitDevices.has(deviceId)) {
      if (!firstTime(`U|${terminalOf(event)}|${event.deviceUserId}|${common.date}|${common.workCode}`)) return;
      unmapped.push({ ...common, deviceUserId: event.deviceUserId, nameOnDevice: nameOnDevice.get(`${deviceId}|${event.deviceUserId}`) ?? null });
    }
  });

  return {
    unit: { _id: idOf(unit._id), name: unit.name, code: unit.code },
    date,
    dateLabel: `${formatDay(date)}  --  ${formatDay(date)}`,
    hasLogo: Boolean(LOGO_BY_UNIT_CODE[unit.code]),
    total: rows.length,
    // Repeated rows left out, so the count can be reconciled with the store.
    duplicates,
    /**
     * Paged on request (the Reports screen). Which unit a punch belongs to is
     * decided by its employee mapping, so the day's punches are classified
     * whole and the page is a slice of them; the PDF is never paged.
     */
    ...(isPaged({ page, limit }) ? slicePage(rows, { page, limit }) : { rows }),
    unmapped,
  };
};

/**
 * The same report as a PDF, laid out like the terminal software's own
 * Transaction Report. Refused (404) when there are no records, so nobody is
 * handed an empty or misleading page.
 */
export const transactionReportPdf = async (query, req) => {
  const report = await transactionReport(withoutPaging(query), req);
  if (!report.rows.length) {
    throw ApiError.notFound('No transaction records found for the selected unit and date.');
  }

  const logoPath = LOGO_BY_UNIT_CODE[report.unit.code];
  const buffer = await buildTransactionReportPdf({
    companyName: report.unit.name,
    title: 'Transaction Report',
    dateLabel: report.dateLabel,
    rows: report.rows,
    unmappedCount: report.unmapped.length,
    logoPath: logoPath && fs.existsSync(logoPath) ? logoPath : null,
  });

  return { buffer, filename: `Transaction_Report_${report.unit.code}_${report.date}.pdf`, rowCount: report.rows.length };
};

export default { transactionReport, transactionReportPdf };
