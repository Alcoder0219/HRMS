import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/AddOutlined';
import EditIcon from '@mui/icons-material/EditOutlined';

import PageHeader from '@components/common/PageHeader.jsx';
import DataTable from '@components/common/DataTable.jsx';
import EmployeePicker from '@components/common/EmployeePicker.jsx';
import ExportMenu from '@components/common/ExportMenu.jsx';
import usePermissions from '@hooks/usePermissions.js';
import { RESOURCES, ACTIONS } from '@utils/permissions.js';
import payrollService from '@services/modules/payroll.service.js';
import SalaryStructureDialog from './components/SalaryStructureDialog.jsx';
import { formatCurrency, formatDate, humanize } from '@utils/format.js';
import { getRowId, displayName } from '@utils/dataGrid.js';
import { PATHS } from '@routes/paths.js';

const yesNo = (value) => (
  <Chip label={value ? 'Yes' : 'No'} size="small" color={value ? 'success' : 'default'} variant="outlined" />
);

/**
 * An employee's salary structure and its revision history.
 *
 * Structures are effective-dated rather than overwritten: a payslip issued last
 * March must still be reproducible from the figures that applied then, so a
 * revision adds a row and closes the previous one.
 *
 * There is no org-wide list endpoint -- the API reads a structure per employee,
 * which is also the only way it can be scoped safely -- so the screen starts
 * from a person rather than from a table.
 */
const SalaryStructuresPage = () => {
  const { can } = usePermissions();
  // Setting pay is gated on APPROVE server-side: it is the input every future
  // payslip is priced from, not an ordinary create.
  const canRevise = can(RESOURCES.PAYROLL, ACTIONS.APPROVE);

  const [employee, setEmployee] = useState(null);
  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(() => {
    if (!employee) {
      setCurrent(null);
      setHistory([]);
      return;
    }

    const employeeId = getRowId(employee);
    setLoading(true);
    setError(null);

    Promise.all([
      // A person with no structure yet is an ordinary state, not an error --
      // the history call still tells us that much.
      payrollService.currentStructure(employeeId).catch(() => ({ data: null })),
      payrollService.structureHistory(employeeId).catch(() => ({ data: [] })),
    ])
      .then(([currentResponse, historyResponse]) => {
        setCurrent(currentResponse.data);
        setHistory(historyResponse.data ?? []);
      })
      .catch((rejection) => setError(rejection?.message ?? 'Could not load the salary structure'))
      .finally(() => setLoading(false));
  }, [employee]);

  useEffect(() => {
    load();
  }, [load]);

  const columns = [
    {
      key: 'effectiveFrom',
      label: 'Effective from',
      exportValue: (row) => formatDate(row.effectiveFrom),
      render: (row) => formatDate(row.effectiveFrom),
    },
    {
      key: 'effectiveTo',
      label: 'Until',
      exportValue: (row) => (row.effectiveTo ? formatDate(row.effectiveTo) : 'Current'),
      render: (row) => (row.effectiveTo ? formatDate(row.effectiveTo) : <Chip label="Current" size="small" color="success" />),
    },
    {
      key: 'annualCtc',
      label: 'Annual CTC',
      align: 'right',
      exportValue: (row) => row.annualCtc,
      render: (row) => formatCurrency(row.annualCtc),
    },
    {
      key: 'monthlyCtc',
      label: 'Monthly CTC',
      align: 'right',
      exportValue: (row) => row.monthlyCtc,
      render: (row) => formatCurrency(row.monthlyCtc),
    },
    { key: 'basic', label: 'Basic', align: 'right', exportValue: (row) => row.basic, render: (row) => formatCurrency(row.basic) },
    { key: 'hra', label: 'HRA', align: 'right', exportValue: (row) => row.hra, render: (row) => formatCurrency(row.hra) },
    {
      key: 'revisionReason',
      label: 'Reason',
      exportValue: (row) => row.revisionReason,
      render: (row) => (
        <Typography variant="caption" color="text.secondary">
          {row.revisionReason || '—'}
        </Typography>
      ),
    },
  ];

  const line = (label, value) => (
    <Stack direction="row" justifyContent="space-between" sx={{ py: 0.75 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={500}>
        {value}
      </Typography>
    </Stack>
  );

  return (
    <Box>
      <PageHeader
        title="Salary Structures"
        subtitle="Effective-dated pay for one employee, and every revision behind it"
        breadcrumbs={[{ label: 'Home', to: PATHS.dashboard }, { label: 'Payroll' }, { label: 'Salary Structures' }]}
        actions={
          employee ? (
            <Stack direction="row" spacing={1} data-print="hide">
              <ExportMenu
                columns={columns}
                rows={history}
                filename={`salary-history-${employee.employeeCode ?? 'employee'}`}
                onError={(message) => setNotice({ severity: 'error', message })}
              />
              {canRevise && (
                <Button
                  variant="contained"
                  startIcon={current ? <EditIcon /> : <AddIcon />}
                  onClick={() => setDialogOpen(true)}
                >
                  {current ? 'Revise salary' : 'Set structure'}
                </Button>
              )}
            </Stack>
          ) : null
        }
      />

      {notice && (
        <Alert severity={notice.severity} sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice.message}
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Box sx={{ mb: 3 }}>
        <EmployeePicker
          value={employee}
          onChange={setEmployee}
          label="Employee"
          sx={{ width: { xs: '100%', sm: 420 } }}
          helperText="Structures are read per employee — pick someone to begin"
        />
      </Box>

      {!employee && (
        <Alert severity="info">Search for an employee above to see their salary structure.</Alert>
      )}

      {employee && !loading && !current && (
        <Alert
          severity="warning"
          sx={{ mb: 3 }}
          action={
            canRevise ? (
              <Button size="small" color="inherit" onClick={() => setDialogOpen(true)}>
                Set structure
              </Button>
            ) : null
          }
        >
          {displayName(employee)} has no salary structure. Payroll cannot price them until one is set.
        </Alert>
      )}

      {current && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Card variant="outlined" sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h6">Current structure</Typography>
                <Typography variant="caption" color="text.secondary">
                  Effective from {formatDate(current.effectiveFrom)}
                </Typography>

                <Divider sx={{ my: 2 }} />

                {line('Annual CTC', formatCurrency(current.annualCtc))}
                {line('Monthly CTC', formatCurrency(current.monthlyCtc))}
                <Divider sx={{ my: 1 }} />
                {line('Basic', formatCurrency(current.basic))}
                {line('HRA', formatCurrency(current.hra))}
                {line('DA', formatCurrency(current.da))}
                {line('Special allowance', formatCurrency(current.specialAllowance))}

                {(current.otherAllowances ?? []).map((allowance) => (
                  <Box key={allowance.code + allowance.label}>{line(allowance.label, formatCurrency(allowance.amount))}</Box>
                ))}
              </CardContent>
            </Card>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Card variant="outlined" sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h6">Statutory and overtime</Typography>
                <Typography variant="caption" color="text.secondary">
                  What the payslip engine will apply
                </Typography>

                <Divider sx={{ my: 2 }} />

                {line('Provident fund', yesNo(current.pfApplicable))}
                {line('ESI', yesNo(current.esiApplicable))}
                {line('Professional tax', yesNo(current.ptApplicable))}
                {line('TDS', yesNo(current.tdsApplicable))}
                {line('Tax regime', humanize(current.taxRegime))}
                <Divider sx={{ my: 1 }} />
                {line('Overtime eligible', yesNo(current.overtimeEligible))}
                {line('Overtime multiplier', `${current.overtimeMultiplier}x`)}
                {current.tdsOverride !== null && current.tdsOverride !== undefined
                  ? line('TDS override', formatCurrency(current.tdsOverride))
                  : null}
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {employee && (
        <>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Revision history
          </Typography>

          <DataTable
            columns={columns}
            rows={history}
            loading={loading}
            error={error}
            onRetry={load}
            emptyTitle="No revisions recorded"
            emptyMessage="Every change to this employee's pay will be listed here."
          />
        </>
      )}

      <SalaryStructureDialog
        open={dialogOpen}
        employee={employee ? getRowId(employee) : null}
        current={current}
        onClose={() => setDialogOpen(false)}
        onSaved={(message) => {
          setDialogOpen(false);
          setNotice({ severity: 'success', message });
          load();
        }}
      />
    </Box>
  );
};

export default SalaryStructuresPage;
