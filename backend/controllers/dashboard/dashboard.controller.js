import asyncHandler from '../../utils/asyncHandler.js';
import ApiResponse from '../../utils/ApiResponse.js';
import dashboardService from '../../services/dashboard/dashboard.service.js';

const query = (req) => req.validatedQuery ?? {};

export const employees = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await dashboardService.employeeOverview(query(req), req), 'Employee overview'),
);

export const attendance = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await dashboardService.attendanceOverview(query(req), req), 'Attendance overview'),
);

export const today = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await dashboardService.todayOverview(query(req), req), 'Today'),
);

export const leave = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await dashboardService.leaveOverview(query(req), req), 'Leave overview'),
);

export const payroll = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await dashboardService.payrollOverview(query(req), req), 'Payroll overview'),
);

export default { employees, attendance, today, leave, payroll };
