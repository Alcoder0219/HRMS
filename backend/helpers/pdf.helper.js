import PDFDocument from 'pdfkit';
import { CURRENCY } from '../utils/constants.js';

/**
 * Payslip PDF rendering.
 *
 * Built with pdfkit rather than an HTML-to-PDF pipeline: a payslip is a fixed
 * statutory-style document, and pulling in a headless browser to lay out two
 * columns of numbers is a large dependency and a large attack surface for no
 * benefit.
 *
 * Renders to a Buffer so the caller can stream it, attach it to an email, or
 * archive it without a temporary file.
 */

const COLORS = {
  primary: '#1565c0',
  text: '#1c252e',
  muted: '#5a6a78',
  line: '#d9e0e8',
  band: '#f4f6f8',
};

/**
 * The date and number locale.
 *
 * `en-TZ` is not present in every Node ICU build, and an unknown locale makes
 * `Intl` fall back to the runtime default -- which on a server in another
 * region formats dates the wrong way round. `en-GB` is the tested fallback:
 * Tanzania writes dates day-first and groups digits in thousands, which is
 * exactly what it produces.
 */
const LOCALES = [CURRENCY.LOCALE, 'en-GB'];

/**
 * An amount, always with its symbol spaced away from the digits.
 *
 * `TSH 1,250,000.00`, not `TSH1,250,000.00` -- an alphabetic symbol run
 * together with a number is read as one token and misparsed by eye.
 */
const money = (value, currency = CURRENCY.SYMBOL) => {
  const amount = Number(value || 0);
  const formatted = new Intl.NumberFormat(LOCALES, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);

  // Settings store the ISO code; the payslip shows the local symbol.
  const label = currency === CURRENCY.CODE ? CURRENCY.SYMBOL : currency;
  return `${label} ${formatted}`;
};

const formatDate = (value) =>
  value
    ? new Date(value).toLocaleDateString(LOCALES, { day: '2-digit', month: 'short', year: 'numeric' })
    : '-';

/**
 * Converts a number to words for the statutory "amount in words" line.
 *
 * Short-scale grouping -- thousand, million, billion -- which is how amounts
 * are written in Tanzania. `Intl` cannot produce words in any scale, so the
 * grouping is done by hand either way; what changed from the Indian version is
 * the group sizes (three digits throughout, rather than a lakh and crore break)
 * and the currency name.
 */
export const amountInWords = (value) => {
  const number = Math.floor(Math.abs(Number(value) || 0));
  if (number === 0) return 'Zero Shillings Only';

  const ones = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
  ];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const twoDigits = (n) =>
    n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? ` ${ones[n % 10]}` : ''}`;

  const threeDigits = (n) =>
    n >= 100
      ? `${ones[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${twoDigits(n % 100)}` : ''}`
      : twoDigits(n);

  // Largest group first. Trillion is the ceiling: a payslip beyond that is a
  // data-entry error, not a figure to render politely.
  const GROUPS = [
    { divisor: 1_000_000_000_000, name: 'Trillion' },
    { divisor: 1_000_000_000, name: 'Billion' },
    { divisor: 1_000_000, name: 'Million' },
    { divisor: 1_000, name: 'Thousand' },
  ];

  const parts = [];
  let remainder = number;

  GROUPS.forEach(({ divisor, name }) => {
    const count = Math.floor(remainder / divisor);
    if (count) {
      parts.push(`${threeDigits(count)} ${name}`);
      remainder %= divisor;
    }
  });

  if (remainder) parts.push(threeDigits(remainder));

  return `${parts.join(' ')} Shillings Only`;
};

const drawDivider = (doc, y) => {
  doc.strokeColor(COLORS.line).lineWidth(0.7).moveTo(40, y).lineTo(555, y).stroke();
};

const labelValue = (doc, x, y, label, value, width = 160) => {
  doc.fontSize(7.5).fillColor(COLORS.muted).text(String(label).toUpperCase(), x, y, { width });
  doc.fontSize(9.5).fillColor(COLORS.text).text(value ?? '-', x, y + 10, { width });
};

/**
 * Renders one payslip.
 *
 * @param {object} payslip  A persisted payslip document (lean or hydrated)
 * @param {object} company  { name, address, logoText }
 */
export const buildPayslipPdf = (payslip, company = {}) =>
  new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 40, info: {
        Title: `Payslip ${payslip.period} - ${payslip.employeeSnapshot?.employeeCode ?? ''}`,
        Author: company.name ?? 'HRMS',
      } });

      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const employee = payslip.employeeSnapshot ?? {};

      /* ------------------------------------------------------- header -- */
      doc.rect(40, 40, 515, 54).fill(COLORS.primary);
      doc.fillColor('#ffffff').fontSize(16).text(company.name ?? 'HRMS', 52, 54);
      doc.fontSize(8.5).fillColor('#dbe7f6').text(company.address ?? '', 52, 74, { width: 300 });

      doc.fontSize(11).fillColor('#ffffff').text('PAYSLIP', 380, 55, { width: 160, align: 'right' });
      doc.fontSize(9).fillColor('#dbe7f6').text(payslip.period, 380, 72, { width: 160, align: 'right' });

      /* ----------------------------------------------------- employee -- */
      let y = 112;
      labelValue(doc, 40, y, 'Employee', employee.fullName);
      labelValue(doc, 210, y, 'Employee Code', employee.employeeCode);
      labelValue(doc, 380, y, 'Date of Joining', formatDate(employee.joiningDate));

      y += 34;
      labelValue(doc, 40, y, 'Designation', employee.designation);
      labelValue(doc, 210, y, 'Department', employee.department);
      labelValue(doc, 380, y, 'TIN', employee.tinNumber);

      y += 34;
      labelValue(doc, 40, y, 'NSSF No.', employee.nssfNumber);
      labelValue(doc, 210, y, 'Bank', employee.bankName);
      labelValue(doc, 380, y, 'Account', employee.accountNumberMasked);

      /* --------------------------------------------------- attendance -- */
      y += 36;
      drawDivider(doc, y);
      y += 8;

      const attendance = payslip.attendance ?? {};
      doc.rect(40, y, 515, 24).fill(COLORS.band);
      doc.fillColor(COLORS.text).fontSize(8.5);
      doc.text(`Days in month: ${attendance.totalDays ?? '-'}`, 52, y + 8);
      doc.text(`Payable days: ${attendance.payableDays ?? '-'}`, 180, y + 8);
      doc.text(`Loss of pay: ${attendance.lopDays ?? 0}`, 310, y + 8);
      doc.text(
        `Overtime: ${attendance.overtimeMinutes ? `${(attendance.overtimeMinutes / 60).toFixed(1)} hrs` : '-'}`,
        420,
        y + 8,
      );

      /* --------------------------------------- earnings and deductions -- */
      y += 40;
      const columnTop = y;

      doc.fontSize(9.5).fillColor(COLORS.primary).text('EARNINGS', 40, y);
      doc.text('DEDUCTIONS', 310, y);
      y += 14;
      drawDivider(doc, y - 3);

      const renderColumn = (items, x, startY) => {
        let cursor = startY;
        items.forEach((item) => {
          doc.fontSize(9).fillColor(COLORS.text).text(item.label, x, cursor, { width: 150 });
          doc.text(money(item.amount, company.currency), x + 150, cursor, { width: 95, align: 'right' });
          cursor += 15;
        });
        return cursor;
      };

      const earningsEnd = renderColumn(payslip.earnings ?? [], 40, y + 4);
      const deductionsEnd = renderColumn(payslip.deductions ?? [], 310, y + 4);

      // Both columns share a baseline so the totals line up regardless of
      // which side has more rows.
      const totalsY = Math.max(earningsEnd, deductionsEnd) + 6;
      drawDivider(doc, totalsY - 3);

      doc.fontSize(9.5).fillColor(COLORS.text);
      doc.text('Gross Earnings', 40, totalsY, { width: 150 });
      doc.text(money(payslip.grossEarnings, company.currency), 190, totalsY, { width: 95, align: 'right' });
      doc.text('Total Deductions', 310, totalsY, { width: 150 });
      doc.text(money(payslip.totalDeductions, company.currency), 460, totalsY, { width: 95, align: 'right' });

      /* ---------------------------------------------------- net payable -- */
      y = totalsY + 26;
      doc.rect(40, y, 515, 34).fill(COLORS.primary);
      doc.fillColor('#ffffff').fontSize(11).text('NET PAYABLE', 52, y + 11);
      doc
        .fontSize(13)
        .text(money(payslip.netPayable, company.currency), 300, y + 9, { width: 243, align: 'right' });

      y += 42;
      doc.fontSize(8.5).fillColor(COLORS.muted).text(amountInWords(payslip.netPayable), 40, y, { width: 515 });

      /* ------------------------------------------- employer + YTD ------- */
      if (payslip.employerContributions?.length) {
        y += 22;
        doc.fontSize(9).fillColor(COLORS.primary).text('EMPLOYER CONTRIBUTIONS', 40, y);
        y += 13;
        payslip.employerContributions.forEach((item) => {
          doc.fontSize(8.5).fillColor(COLORS.text).text(item.label, 40, y, { width: 200 });
          doc.text(money(item.amount, company.currency), 240, y, { width: 95, align: 'right' });
          y += 13;
        });
      }

      if (payslip.ytd) {
        y += 10;
        drawDivider(doc, y);
        y += 8;
        doc.fontSize(8).fillColor(COLORS.muted);
        doc.text(
          `Year to date  ·  Gross ${money(payslip.ytd.gross, company.currency)}  ·  Deductions ${money(
            payslip.ytd.deductions,
            company.currency,
          )}  ·  Net ${money(payslip.ytd.net, company.currency)}  ·  PAYE ${money(payslip.ytd.paye, company.currency)}`,
          40,
          y,
          { width: 515 },
        );
      }

      /* -------------------------------------------------------- footer -- */
      doc.fontSize(7.5).fillColor(COLORS.muted).text(
        'This is a computer-generated payslip and does not require a signature.',
        40,
        780,
        { width: 515, align: 'center' },
      );

      doc.end();
    } catch (error) {
      reject(error);
    }
  });

/**
 * Renders the full and final settlement sheet.
 *
 * Longer and more explanatory than a payslip on purpose: this is the document
 * an ex-employee reads without anyone to ask, and every derived figure --
 * service span, severance formula, notice days -- is shown with its working
 * rather than as a bare total.
 */
export const buildSettlementPdf = (settlement, company = {}) =>
  new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
        info: {
          Title: `Full & Final Settlement ${settlement.settlementNumber}`,
          Author: company.name ?? 'HRMS',
        },
      });

      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const employee = settlement.employeeSnapshot ?? {};
      const service = settlement.service ?? {};

      /* ------------------------------------------------------- header -- */
      doc.rect(40, 40, 515, 56).fill(COLORS.primary);
      doc.fillColor('#ffffff').fontSize(15).text(company.name ?? 'HRMS', 52, 54);
      doc.fontSize(8.5).fillColor('#dbe7f6').text(company.address ?? '', 52, 74, { width: 300 });
      doc.fontSize(11).fillColor('#ffffff').text('FULL & FINAL SETTLEMENT', 330, 56, { width: 212, align: 'right' });
      doc.fontSize(8.5).fillColor('#dbe7f6').text(settlement.settlementNumber, 330, 74, { width: 212, align: 'right' });

      /* ----------------------------------------------------- employee -- */
      let y = 114;
      labelValue(doc, 40, y, 'Employee', employee.fullName);
      labelValue(doc, 210, y, 'Employee Code', employee.employeeCode);
      labelValue(doc, 380, y, 'Exit Type', String(settlement.trigger ?? '').replace(/_/g, ' '));

      y += 34;
      labelValue(doc, 40, y, 'Designation', employee.designation);
      labelValue(doc, 210, y, 'Department', employee.department);
      labelValue(doc, 380, y, 'TIN', employee.tinNumber);

      y += 34;
      labelValue(doc, 40, y, 'Date of Joining', formatDate(settlement.joiningDate));
      labelValue(doc, 210, y, 'Last Working Date', formatDate(settlement.lastWorkingDate));
      labelValue(
        doc,
        380,
        y,
        'Service',
        `${service.years ?? 0}y ${service.months ?? 0}m ${service.days ?? 0}d`,
      );

      /* -------------------------------------------------- calculation -- */
      y += 36;
      drawDivider(doc, y);
      y += 8;

      doc.rect(40, y, 515, 40).fill(COLORS.band);
      doc.fillColor(COLORS.text).fontSize(8);

      const severance = settlement.severance ?? {};
      const notice = settlement.notice ?? {};

      doc.text(
        `Severance: ${
          severance.eligible
            ? `${severance.countedYears} completed year(s) × 7/30 × ${money(severance.wages, company.currency)}`
            : (severance.reason ?? 'Not eligible')
        }`,
        52,
        y + 8,
        { width: 490 },
      );
      doc.text(
        `Notice: ${notice.requiredDays ?? 0} day(s) required, ${notice.servedDays ?? 0} served${
          notice.direction && notice.direction !== 'NONE' ? ` — ${notice.reason}` : ' — fully served'
        }`,
        52,
        y + 22,
        { width: 490 },
      );

      /* ---------------------------------------- payable / recoverable -- */
      y += 56;
      doc.fontSize(9.5).fillColor(COLORS.primary).text('PAYABLE', 40, y);
      doc.text('RECOVERABLE', 310, y);
      y += 14;
      drawDivider(doc, y - 3);

      const renderColumn = (items, x, startY) => {
        let cursor = startY;
        (items ?? []).forEach((item) => {
          doc.fontSize(9).fillColor(COLORS.text).text(item.label, x, cursor, { width: 150 });
          doc.text(money(item.amount, company.currency), x + 150, cursor, { width: 95, align: 'right' });

          // The derived lines carry their working underneath, so the number is
          // never presented without an explanation.
          if (item.meta?.days) {
            doc
              .fontSize(7)
              .fillColor(COLORS.muted)
              .text(`${item.meta.days} day(s) @ ${money(item.meta.perDay, company.currency)}`, x, cursor + 10, {
                width: 240,
              });
            cursor += 9;
          }

          cursor += 15;
        });
        return cursor;
      };

      const earningsEnd = renderColumn(settlement.earnings, 40, y + 4);
      const deductionsEnd = renderColumn(settlement.deductions, 310, y + 4);

      const totalsY = Math.max(earningsEnd, deductionsEnd) + 6;
      drawDivider(doc, totalsY - 3);

      doc.fontSize(9.5).fillColor(COLORS.text);
      doc.text('Total Payable', 40, totalsY, { width: 150 });
      doc.text(money(settlement.totalEarnings, company.currency), 190, totalsY, { width: 95, align: 'right' });
      doc.text('Total Recoverable', 310, totalsY, { width: 150 });
      doc.text(money(settlement.totalDeductions, company.currency), 460, totalsY, { width: 95, align: 'right' });

      /* ------------------------------------------------------ the net -- */
      const owesCompany = settlement.payableTo === 'COMPANY';
      const netAmount = Math.abs(settlement.netSettlement ?? 0);

      y = totalsY + 26;
      doc.rect(40, y, 515, 36).fill(owesCompany ? '#b3261e' : COLORS.primary);
      doc
        .fillColor('#ffffff')
        .fontSize(10.5)
        .text(owesCompany ? 'RECOVERABLE FROM EMPLOYEE' : 'NET SETTLEMENT PAYABLE', 52, y + 12);
      doc.fontSize(13).text(money(netAmount, company.currency), 300, y + 10, { width: 243, align: 'right' });

      y += 44;
      doc.fontSize(8.5).fillColor(COLORS.muted).text(amountInWords(netAmount), 40, y, { width: 515 });

      /* ------------------------------------------------------- assets -- */
      if (settlement.assets?.length) {
        y += 22;
        doc.fontSize(9).fillColor(COLORS.primary).text('COMPANY ASSETS', 40, y);
        y += 13;
        settlement.assets.forEach((asset) => {
          doc.fontSize(8).fillColor(COLORS.text).text(`${asset.assetCode} · ${asset.name}`, 40, y, { width: 300 });
          doc.text(money(asset.recoveryAmount, company.currency), 340, y, { width: 95, align: 'right' });
          y += 12;
        });
      }

      /* ---------------------------------------------------- approvals -- */
      if (settlement.approvals?.length) {
        y += 14;
        drawDivider(doc, y);
        y += 8;
        doc.fontSize(8).fillColor(COLORS.muted);
        settlement.approvals.forEach((approval) => {
          doc.text(
            `${approval.stage} · ${approval.decision} · ${approval.byEmail ?? ''} · ${formatDate(approval.at)}${
              approval.comment ? ` · ${approval.comment}` : ''
            }`,
            40,
            y,
            { width: 515 },
          );
          y += 11;
        });
      }

      doc
        .fontSize(7.5)
        .fillColor(COLORS.muted)
        .text(
          'This settlement is computed from the records held on the date of issue. Raise any discrepancy with HR before accepting payment.',
          40,
          770,
          { width: 515, align: 'center' },
        );

      doc.end();
    } catch (error) {
      reject(error);
    }
  });

/**
 * Generic landscape table PDF, for reports meant to be circulated rather than
 * analysed. Excel remains the right output for anything to be worked on; this
 * is for the version that gets emailed or printed.
 *
 * Paginates on height and repeats the header on every page, because a report
 * whose column headings appear only on page one is unreadable from page two.
 */
export const buildTablePdf = ({ title, subtitle, columns, rows, company = {} }) =>
  new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 32, info: { Title: title } });

      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const left = 32;
      const pageBottom = doc.page.height - 48;
      let y = 0;

      const drawHeader = () => {
        doc.rect(left, 32, doc.page.width - 64, 40).fill(COLORS.primary);
        doc.fillColor('#ffffff').fontSize(13).text(company.name ?? 'HRMS', left + 12, 42);
        doc.fontSize(10).text(title, left + 12, 58);
        if (subtitle) {
          doc.fontSize(9).fillColor('#dbe7f6').text(subtitle, doc.page.width - 260, 46, { width: 216, align: 'right' });
        }

        y = 84;
        doc.fontSize(7.5).fillColor(COLORS.muted);

        let x = left;
        columns.forEach((column) => {
          doc.text(String(column.header).toUpperCase(), x, y, {
            width: column.width,
            align: column.align ?? 'left',
          });
          x += column.width;
        });

        y += 12;
        drawDivider(doc, y - 2);
        y += 4;
      };

      drawHeader();

      rows.forEach((row, index) => {
        if (y > pageBottom) {
          doc.addPage({ size: 'A4', layout: 'landscape', margin: 32 });
          drawHeader();
        }

        // Zebra striping: at 30+ rows per page the eye loses the line without it.
        if (index % 2 === 1) {
          doc.rect(left, y - 2, doc.page.width - 64, 13).fill(COLORS.band);
        }

        let x = left;
        doc.fontSize(8).fillColor(COLORS.text);
        columns.forEach((column) => {
          const value = row[column.key];
          doc.text(value === null || value === undefined ? '-' : String(value), x, y, {
            width: column.width,
            align: column.align ?? 'left',
            ellipsis: true,
            lineBreak: false,
          });
          x += column.width;
        });

        y += 13;
      });

      doc
        .fontSize(7)
        .fillColor(COLORS.muted)
        .text(
          `${rows.length} row(s) · generated ${new Date().toLocaleString(LOCALES)}`,
          left,
          doc.page.height - 40,
        );

      doc.end();
    } catch (error) {
      reject(error);
    }
  });

/**
 * An offer letter.
 *
 * A letter rather than a table: this one is read by the candidate, not by a
 * payroll clerk, so it is laid out as prose with the terms broken out. Portrait
 * for the same reason -- it is meant to be printed and signed.
 */
export const buildOfferLetterPdf = ({ offer, candidate, company = {} }) =>
  new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 56,
        info: { Title: `Offer ${offer.offerNumber}` },
      });

      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const width = doc.page.width - 112;
      const date = (value) =>
        value
          ? new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
          : '—';

      /* --- letterhead ---------------------------------------------------- */
      doc.rect(0, 0, doc.page.width, 90).fill(COLORS.primary);
      doc.fillColor('#ffffff').fontSize(18).text(company.name ?? 'HRMS', 56, 30);
      doc.fontSize(9).fillColor('#dbe7f6').text('Letter of Offer', 56, 56);
      doc.fontSize(9).text(offer.offerNumber, doc.page.width - 200, 56, { width: 144, align: 'right' });

      doc.fillColor(COLORS.text).fontSize(10);
      let y = 120;

      doc.text(date(offer.createdAt ?? new Date()), 56, y, { width, align: 'right' });
      y += 26;

      doc.fontSize(11).text(`${candidate.firstName} ${candidate.lastName}`, 56, y);
      y += 16;
      doc.fontSize(9).fillColor(COLORS.muted).text(candidate.email ?? '', 56, y);
      y += 30;

      doc.fillColor(COLORS.text).fontSize(10);
      doc.text('Dear ' + candidate.firstName + ',', 56, y);
      y += 22;

      doc.text(
        `We are pleased to offer you the position described below. This offer is made on the terms set out here and is subject to the satisfactory completion of our joining formalities.`,
        56,
        y,
        { width, align: 'justify' },
      );
      y += 52;

      /* --- terms ---------------------------------------------------------- */
      const rows = [
        ['Position', offer.designationName ?? '—'],
        ['Department', offer.departmentName ?? '—'],
        ['Location', offer.unitName ?? '—'],
        ['Employment type', String(offer.employmentType ?? '').replace(/_/g, ' ')],
        ['Annual CTC', money(offer.annualCtc)],
        ['Proposed joining date', date(offer.proposedJoiningDate)],
        ...(offer.probationMonths ? [['Probation', `${offer.probationMonths} month(s)`]] : []),
        ...(offer.noticePeriodDays ? [['Notice period', `${offer.noticePeriodDays} day(s)`]] : []),
        ...(offer.validUntil ? [['Offer valid until', date(offer.validUntil)]] : []),
      ];

      doc.rect(56, y, width, rows.length * 22 + 12).fill(COLORS.band);
      y += 10;

      rows.forEach(([label, value]) => {
        doc.fillColor(COLORS.muted).fontSize(9).text(label, 68, y, { width: 160 });
        doc.fillColor(COLORS.text).fontSize(10).text(String(value), 240, y, { width: width - 196 });
        y += 22;
      });

      y += 20;

      doc.fillColor(COLORS.text).fontSize(10);
      doc.text(
        `Please confirm your acceptance by replying to this letter on or before the date above. We look forward to welcoming you.`,
        56,
        y,
        { width, align: 'justify' },
      );
      y += 60;

      /* --- signatures ------------------------------------------------------ */
      doc.fontSize(9).fillColor(COLORS.muted);
      doc.text('For ' + (company.name ?? 'HRMS'), 56, y);
      doc.text('Accepted by', doc.page.width - 220, y, { width: 164, align: 'left' });

      y += 46;
      doc.moveTo(56, y).lineTo(216, y).strokeColor(COLORS.line).stroke();
      doc.moveTo(doc.page.width - 220, y).lineTo(doc.page.width - 60, y).stroke();

      y += 6;
      doc.fontSize(8).text('Authorised signatory', 56, y);
      doc.text(`${candidate.firstName} ${candidate.lastName}`, doc.page.width - 220, y, { width: 164 });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });

export default { buildPayslipPdf, buildSettlementPdf, buildTablePdf, buildOfferLetterPdf, amountInWords };
