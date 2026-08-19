import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import EditIcon from '@mui/icons-material/EditOutlined';
import SwapIcon from '@mui/icons-material/SwapHorizOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import StatusChip from '@components/common/StatusChip.jsx';
import EmployeeAvatar from '@components/common/EmployeeAvatar.jsx';
import StatusChangeDialog from './components/StatusChangeDialog.jsx';

import { useAppDispatch, useAppSelector } from '@hooks/useRedux.js';
import usePermissions from '@hooks/usePermissions.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import {
  fetchEmployee,
  changeEmployeeStatus,
  clearCurrent,
  selectEmployees,
} from '@redux/slices/employeeSlice.js';
import employeeService from '@services/modules/employee.service.js';
import { formatDate, formatDateTime, formatCurrency, humanize, emptyDash } from '@utils/format.js';
import { ROLE_LABELS } from '@utils/roles.js';
import { employeeIdentifiers } from '@utils/dataGrid.js';
import { PATHS } from '@routes/paths.js';

/** Label/value pair. Masked values arrive pre-masked from the API. */
const Detail = ({ label, value, span = { xs: 12, sm: 6, md: 4 } }) => (
  <Grid size={span}>
    <Typography variant="caption" color="text.secondary" display="block">
      {label}
    </Typography>
    <Typography variant="body2" sx={{ mt: 0.25 }}>
      {emptyDash(value)}
    </Typography>
  </Grid>
);

const Section = ({ title, children }) => (
  <Card variant="outlined" sx={{ mb: 2 }}>
    <CardContent>
      <Typography variant="overline" color="text.secondary">
        {title}
      </Typography>
      <Grid container spacing={2.5} sx={{ mt: 0.5 }}>
        {children}
      </Grid>
    </CardContent>
  </Card>
);

const EmployeeDetailPage = () => {
  const { id } = useParams();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { can } = usePermissions();

  const { current: employee, status, error } = useAppSelector(selectEmployees);

  const [tab, setTab] = useState(0);
  const [statusOpen, setStatusOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [audit, setAudit] = useState([]);

  /**
   * The employee's photograph, when it was uploaded through the Documents tab.
   *
   * Read from the record already in the store rather than fetched: the
   * documents array travels with the employee, so finding the PHOTO entry costs
   * nothing and the avatar needs only its id.
   */
  const photoDocumentId = employee?.documents?.find((document) => document.type === 'PHOTO')?._id ?? null;

  useEffect(() => {
    dispatch(fetchEmployee(id));
    return () => dispatch(clearCurrent());
  }, [dispatch, id]);

  // The trail is only fetched when its tab is opened -- it is a separate,
  // potentially long query that most visits never need.
  useEffect(() => {
    if (tab !== 3 || audit.length) return;
    employeeService
      .auditTrail(id, { page: 1, limit: 50 })
      .then((response) => setAudit(response.data))
      .catch(() => setAudit([]));
  }, [tab, id, audit.length]);

  const handleStatusChange = async (payload) => {
    setBusy(true);
    try {
      await dispatch(changeEmployeeStatus({ id, payload })).unwrap();
      setStatusOpen(false);
      // The trail has a new entry; drop the cache so the tab refetches.
      setAudit([]);
    } finally {
      setBusy(false);
    }
  };

  if (status === 'loading' && !employee) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: 320 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error && !employee) return <Alert severity="error">{error.message}</Alert>;
  if (!employee) return null;

  return (
    <Box>
      <PageHeader
        title={employee.fullName}
        subtitle={`${employeeIdentifiers(employee)} · ${employee.designationId?.name ?? 'No designation'}`}
        breadcrumbs={[
          { label: 'Home', to: PATHS.dashboard },
          { label: 'Employees', to: PATHS.employees },
          { label: employee.employeeCode },
        ]}
        actions={
          <>
            {can(RESOURCES.EMPLOYEE, ACTIONS.APPROVE) && (
              <Button
                variant="outlined"
                color="inherit"
                startIcon={<SwapIcon />}
                onClick={() => setStatusOpen(true)}
              >
                Change status
              </Button>
            )}
            {can(RESOURCES.EMPLOYEE, ACTIONS.UPDATE) && (
              <Button
                variant="contained"
                startIcon={<EditIcon />}
                onClick={() => navigate(PATHS.employeeEdit(id))}
              >
                Edit
              </Button>
            )}
          </>
        }
      />

      <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} alignItems={{ sm: 'center' }}>
          {/* Resolves the photograph from either source and falls back to
              initials, identically to the list and the profile header. */}
          <EmployeeAvatar
            employee={employee}
            employeeId={employee._id}
            photoDocumentId={photoDocumentId}
            size={84}
          />

          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap">
              <Typography variant="h4">{employee.fullName}</Typography>
              <StatusChip status={employee.status} />
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {employee.departmentId?.name ?? 'No department'} ·{' '}
              {humanize(employee.employmentType)} · Joined {formatDate(employee.joiningDate)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {employee.workEmail ?? employee.personalEmail ?? '—'}
              {employee.mobile ? ` · ${employee.mobile}` : ''}
            </Typography>
          </Box>

          <Stack spacing={0.5} sx={{ textAlign: { sm: 'right' } }}>
            <Typography variant="caption" color="text.secondary">
              Tenure
            </Typography>
            <Typography variant="h4">
              {employee.tenureYears ?? 0}
              <Typography component="span" variant="body2" color="text.secondary">
                {' '}
                yr
              </Typography>
            </Typography>
          </Stack>
        </Stack>
      </Paper>

      <Tabs
        value={tab}
        onChange={(_event, next) => setTab(next)}
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
        variant="scrollable"
        scrollButtons="auto"
      >
        <Tab label="Overview" />
        <Tab label="Statutory & bank" />
        <Tab label="Documents" />
        <Tab label="Audit trail" />
      </Tabs>

      {tab === 0 && (
        <>
          <Section title="Personal">
            <Detail label="Father's name" value={employee.fatherName} />
            <Detail label="Mother's name" value={employee.motherName} />
            <Detail label="Gender" value={humanize(employee.gender)} />
            <Detail label="Date of birth" value={formatDate(employee.dateOfBirth)} />
            <Detail label="Blood group" value={employee.bloodGroup} />
            <Detail label="Marital status" value={humanize(employee.maritalStatus)} />
            <Detail label="Personal email" value={employee.personalEmail} />
            <Detail label="Mobile" value={employee.mobile} />
            <Detail label="Alternate mobile" value={employee.alternateMobile} />
          </Section>

          <Section title="Employment">
            <Detail label="Employee ID" value={employee.employeeId} />
            <Detail label="Department" value={employee.departmentId?.name} />
            <Detail label="Designation" value={employee.designationId?.name} />
            <Detail label="Shift" value={employee.shiftId?.name} />
            <Detail
              label="Reporting manager"
              value={
                employee.reportingManagerId
                  ? `${employee.reportingManagerId.firstName} ${employee.reportingManagerId.lastName}`
                  : null
              }
            />
            <Detail label="Employment type" value={humanize(employee.employmentType)} />
            <Detail label="Work location" value={employee.workLocation} />
            <Detail label="Joining date" value={formatDate(employee.joiningDate)} />
            <Detail label="Confirmation date" value={formatDate(employee.confirmationDate)} />
            {/* CTC is null for callers without edit rights -- masked server-side. */}
            <Detail label="CTC" value={formatCurrency(employee.salaryStructure?.ctc)} />
            <Detail label="Grade" value={employee.salaryStructure?.grade} />
            <Detail label="Band" value={employee.salaryStructure?.band} />
          </Section>

          {employee.status !== 'ACTIVE' && employee.status !== 'PROBATION' && (
            <Section title="Lifecycle">
              <Detail label="Notice start" value={formatDate(employee.lifecycle?.noticeStartDate)} />
              <Detail label="Resignation date" value={formatDate(employee.lifecycle?.resignationDate)} />
              <Detail label="Last working date" value={formatDate(employee.lifecycle?.lastWorkingDate)} />
              <Detail label="Termination date" value={formatDate(employee.lifecycle?.terminationDate)} />
              <Detail label="Retirement date" value={formatDate(employee.lifecycle?.retirementDate)} />
              <Detail
                label="Rehire eligible"
                value={employee.lifecycle?.rehireEligible ? 'Yes' : 'No'}
              />
              <Detail label="Reason" value={employee.lifecycle?.exitReason} span={{ xs: 12 }} />
            </Section>
          )}

          <Section title="Address">
            <Detail
              label="Current"
              span={{ xs: 12, md: 6 }}
              value={[
                employee.currentAddress?.line1,
                employee.currentAddress?.city,
                employee.currentAddress?.state,
                employee.currentAddress?.postalCode,
              ]
                .filter(Boolean)
                .join(', ')}
            />
            <Detail
              label="Permanent"
              span={{ xs: 12, md: 6 }}
              value={[
                employee.permanentAddress?.line1,
                employee.permanentAddress?.city,
                employee.permanentAddress?.state,
                employee.permanentAddress?.postalCode,
              ]
                .filter(Boolean)
                .join(', ')}
            />
          </Section>

          <Section title="Emergency contacts">
            {employee.emergencyContacts?.length ? (
              employee.emergencyContacts.map((contact) => (
                <Detail
                  key={contact._id ?? contact.phone}
                  label={`${contact.name} (${contact.relationship})`}
                  value={contact.phone}
                />
              ))
            ) : (
              <Detail label="Contacts" value={null} span={{ xs: 12 }} />
            )}
          </Section>
        </>
      )}

      {tab === 1 && (
        <>
          <Section title="Statutory">
            <Detail label="NSSF number" value={employee.statutory?.nssfNumber} />
            <Detail label="NHIF number" value={employee.statutory?.nhifNumber} />
            <Detail label="TIN" value={employee.statutory?.tinNumber} />
            <Detail label="National ID (NIDA)" value={employee.statutory?.nationalIdNumber} />
            <Detail label="Passport" value={employee.statutory?.passportNumber} />
            <Detail label="Passport expiry" value={formatDate(employee.statutory?.passportExpiry)} />
            <Detail label="Work permit" value={employee.statutory?.workPermitNumber} />
            <Detail label="Work permit expiry" value={formatDate(employee.statutory?.workPermitExpiry)} />
            <Detail label="Driving license" value={employee.statutory?.drivingLicense} />
          </Section>

          {/*
            Portal access, on the Statutory tab beside the other identity
            records. It is a property of the person, not of their pay, and this
            is the tab a reader already comes to for "who is this and what are
            they registered for".
          */}
          <Section title="Portal access">
            {employee.userId ? (
              <>
                <Detail label="Login email" value={employee.userId.email} />
                <Detail
                  label="Role"
                  value={ROLE_LABELS[employee.userId.role] ?? humanize(employee.userId.role)}
                />
                <Detail label="Account status" value={humanize(employee.userId.status)} />
                <Detail
                  label="Last sign-in"
                  value={
                    employee.userId.lastLoginAt
                      ? formatDate(employee.userId.lastLoginAt, 'dd MMM yyyy, HH:mm')
                      : 'Never signed in'
                  }
                />
                <Detail
                  label="Email verified"
                  value={employee.userId.isEmailVerified ? 'Yes' : 'No'}
                />
              </>
            ) : (
              <Detail
                label="Portal access"
                value="No login account"
                span={{ xs: 12 }}
              />
            )}

            {can(RESOURCES.EMPLOYEE, ACTIONS.UPDATE) && (
              <Grid size={12}>
                <Button
                  size="small"
                  startIcon={<EditIcon />}
                  // The toggle lives on the Employment tab of the edit form.
                  onClick={() => navigate(PATHS.employeeEdit(id))}
                >
                  Manage access
                </Button>
              </Grid>
            )}
          </Section>

          <Section title="Bank details">
            <Detail label="Account holder" value={employee.bankDetails?.accountHolderName} />
            <Detail label="Account number" value={employee.bankDetails?.accountNumber} />
            <Detail label="SWIFT code" value={employee.bankDetails?.swiftCode} />
            <Detail label="Branch code" value={employee.bankDetails?.branchCode} />
            <Detail label="Bank" value={employee.bankDetails?.bankName} />
            <Detail label="Branch" value={employee.bankDetails?.branch} />
            <Detail label="Account type" value={humanize(employee.bankDetails?.accountType)} />
          </Section>

          <Alert severity="info" variant="outlined">
            Identity and bank numbers are partially masked unless you have edit rights on this
            record.
          </Alert>
        </>
      )}

      {tab === 2 && (
        <Paper variant="outlined">
          {employee.documents?.length ? (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Title</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Uploaded</TableCell>
                  <TableCell>Expires</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {employee.documents.map((document) => (
                  <TableRow key={document._id}>
                    <TableCell>{document.title}</TableCell>
                    <TableCell>{humanize(document.type)}</TableCell>
                    <TableCell>{formatDate(document.uploadedAt)}</TableCell>
                    <TableCell>{formatDate(document.expiresAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Box sx={{ p: 4, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                No documents uploaded yet.
              </Typography>
            </Box>
          )}
        </Paper>
      )}

      {tab === 3 && (
        <Paper variant="outlined">
          {audit.length ? (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell width={170}>When</TableCell>
                  <TableCell width={130}>Action</TableCell>
                  <TableCell width={200}>By</TableCell>
                  <TableCell>Changes</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {audit.map((entry) => (
                  <TableRow key={entry._id}>
                    <TableCell>{formatDateTime(entry.occurredAt)}</TableCell>
                    <TableCell>{humanize(entry.action)}</TableCell>
                    <TableCell>
                      <Typography variant="caption">{entry.actorEmail ?? 'System'}</Typography>
                    </TableCell>
                    <TableCell>
                      {entry.changes?.length ? (
                        <Stack spacing={0.25}>
                          {entry.changes.slice(0, 4).map((change) => (
                            <Typography key={change.field} variant="caption">
                              <strong>{change.field}</strong>: {emptyDash(change.from)} →{' '}
                              {emptyDash(change.to)}
                            </Typography>
                          ))}
                          {entry.changes.length > 4 && (
                            <Typography variant="caption" color="text.secondary">
                              +{entry.changes.length - 4} more
                            </Typography>
                          )}
                        </Stack>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          {entry.metadata ? JSON.stringify(entry.metadata) : '—'}
                        </Typography>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Box sx={{ p: 4, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                No audit entries.
              </Typography>
            </Box>
          )}
        </Paper>
      )}

      <Divider sx={{ my: 3 }} />
      <Typography variant="caption" color="text.secondary">
        Created {formatDateTime(employee.createdAt)} · Last updated{' '}
        {formatDateTime(employee.updatedAt)}
      </Typography>

      <StatusChangeDialog
        open={statusOpen}
        employee={employee}
        busy={busy}
        onClose={() => setStatusOpen(false)}
        onSubmit={handleStatusChange}
      />
    </Box>
  );
};

export default EmployeeDetailPage;
