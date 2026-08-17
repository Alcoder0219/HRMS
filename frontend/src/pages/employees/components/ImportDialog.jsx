import ImportDialog from '@components/common/ImportDialog.jsx';
import employeeService from '@services/modules/employee.service.js';

/**
 * Employee bulk import.
 *
 * The dialog itself is the shared one -- the two-step validate-then-commit
 * flow, the error table and the row summary are identical for every module, and
 * this only supplies the three employee operations. It exists as a named
 * component because the employee screens already import it by this path.
 */
const EmployeeImportDialog = ({ open, onClose, onImported }) => (
  <ImportDialog
    open={open}
    title="Import employees"
    templateName="employee-import-template.xlsx"
    onTemplate={() => employeeService.downloadTemplate()}
    onImport={(file, dryRun) => employeeService.importExcel(file, dryRun)}
    onClose={onClose}
    onImported={onImported}
  />
);

export default EmployeeImportDialog;
