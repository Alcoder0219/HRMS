import PDFDocument from 'pdfkit';

/**
 * The Transaction Report as a PDF, after the terminal software's own report:
 * company name centred, the title and the date range under it, a rule, then a
 * five-column table with black borders and a rule every second row. White
 * page, black text, A4 portrait.
 *
 * The column headings repeat at the top of every page; each page is numbered.
 * A logo, when given, sits at the left of the header and the heading stays
 * centred on the page.
 */

const PAGE = { size: 'A4', margin: 50 };
const COLUMNS = [
  { key: 'employeeId', label: 'Employee ID', width: 78 },
  { key: 'fullName', label: 'Full Name', width: 136 },
  { key: 'date', label: 'Date', width: 117 },
  { key: 'workCode', label: 'Work Code', width: 100 },
  { key: 'recordType', label: 'Record Type', width: 64 },
];
const HEADER_ROW = 20;
const ROW = 21;
const PAD = 3;
const BLACK = '#000000';

export const buildTransactionReportPdf = ({ companyName, title, dateLabel, rows, unmappedCount = 0, logoPath = null }) =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ ...PAGE, bufferPages: true, info: { Title: `${title} — ${companyName}` } });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const tableWidth = COLUMNS.reduce((sum, column) => sum + column.width, 0);
    const tableLeft = left + (width - tableWidth) / 2;
    const bottom = () => doc.page.height - doc.page.margins.bottom - 18;

    doc.fillColor(BLACK).strokeColor(BLACK);

    /* ---------------------------------------------------------- heading -- */
    let y = doc.page.margins.top;
    const logoSize = 58;
    if (logoPath) doc.image(logoPath, left, y - 4, { fit: [logoSize, logoSize] });

    // Centred on the page, kept clear of the logo on both sides so it stays centred.
    const inset = logoPath ? logoSize + 12 : 0;
    const textLeft = left + inset;
    const textWidth = width - inset * 2;

    doc.font('Helvetica-Bold').fontSize(20).text(companyName, textLeft, y, { width: textWidth, align: 'center' });
    y = doc.y + 8;
    doc.font('Helvetica-Bold').fontSize(12).text(title, textLeft, y, { width: textWidth, align: 'center' });
    y = doc.y + 8;
    doc.font('Helvetica-Bold').fontSize(10).text(dateLabel, textLeft, y, { width: textWidth, align: 'center' });
    y = Math.max(doc.y, logoPath ? doc.page.margins.top + logoSize - 4 : 0) + 8;
    doc.moveTo(left, y).lineTo(left + width, y).lineWidth(1.5).stroke();
    y += 18;

    /* ------------------------------------------------------------ table -- */
    const cell = (text, x, rowY, columnWidth, { bold = false, height = ROW } = {}) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 9.5 : 9);
      doc.text(String(text ?? ''), x + PAD, rowY + (height - 9) / 2 - 1, {
        width: columnWidth - PAD * 2,
        height,
        lineBreak: false,
        ellipsis: true,
      });
    };

    const verticals = (fromY, toY) => {
      let x = tableLeft;
      doc.lineWidth(0.8);
      doc.moveTo(x, fromY).lineTo(x, toY).stroke();
      COLUMNS.forEach((column) => {
        x += column.width;
        doc.moveTo(x, fromY).lineTo(x, toY).stroke();
      });
    };

    const rule = (atY) => {
      doc.lineWidth(0.8).moveTo(tableLeft, atY).lineTo(tableLeft + tableWidth, atY).stroke();
    };

    const headerRow = (atY) => {
      rule(atY);
      let x = tableLeft;
      COLUMNS.forEach((column) => {
        cell(column.label, x, atY, column.width, { bold: true, height: HEADER_ROW });
        x += column.width;
      });
      rule(atY + HEADER_ROW);
      return atY + HEADER_ROW;
    };

    let blockTop = y;
    y = headerRow(y);

    rows.forEach((row, index) => {
      if (y + ROW > bottom()) {
        // Close this page's block, then carry the headings over.
        rule(y);
        verticals(blockTop, y);
        doc.addPage();
        doc.fillColor(BLACK).strokeColor(BLACK);
        blockTop = doc.page.margins.top;
        y = headerRow(blockTop);
      }

      let x = tableLeft;
      COLUMNS.forEach((column) => {
        cell(row[column.key], x, y, column.width);
        x += column.width;
      });
      y += ROW;

      // A rule under every second row, as the sample draws it.
      if (index % 2 === 1 && index !== rows.length - 1) rule(y);
    });

    rule(y);
    verticals(blockTop, y);

    if (unmappedCount > 0) {
      const note = `${unmappedCount} punch${unmappedCount === 1 ? '' : 'es'} on this date came from device users not yet mapped to an employee and ${unmappedCount === 1 ? 'is' : 'are'} not listed.`;
      if (y + 30 > bottom()) {
        doc.addPage();
        y = doc.page.margins.top;
      } else {
        y += 12;
      }
      doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(BLACK).text(note, tableLeft, y, { width: tableWidth });
    }

    /* ----------------------------------------------------------- footer -- */
    const { start, count } = doc.bufferedPageRange();
    for (let page = start; page < start + count; page += 1) {
      doc.switchToPage(page);
      doc.font('Helvetica').fontSize(8).fillColor(BLACK);
      // Written inside the bottom margin, which pdfkit would otherwise treat as
      // overflow and answer with a blank extra page.
      const margin = doc.page.margins.bottom;
      const footerY = doc.page.height - margin + 10;
      doc.page.margins.bottom = 0;
      doc.text(`Page ${page - start + 1} of ${count}`, left, footerY, { width, align: 'right', lineBreak: false });
      doc.page.margins.bottom = margin;
    }

    doc.end();
  });

export default { buildTransactionReportPdf };
