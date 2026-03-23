const fs = require("fs");
const path = require("path");
const { getCompanyBranding } = require("./companyBranding");

const FONTS_DIR = path.join(__dirname, "../../node_modules/dejavu-fonts-ttf/ttf");
const DEJAVU_SANS = path.join(FONTS_DIR, "DejaVuSans.ttf");
const DEJAVU_SANS_BOLD = path.join(FONTS_DIR, "DejaVuSans-Bold.ttf");

function fmtInr(n) {
  const v = Number(n) || 0;
  return `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function lineDescription(invoice) {
  const rt = String(invoice.revenueType || "project");
  const labels = {
    project: "Professional services / supply",
    academy: "Academy services",
    event: "Event services",
  };
  if (invoice.isDeferred) return `${labels[rt] || labels.project} (deferred revenue)`;
  return labels[rt] || "Taxable supply";
}

function resolveLogoPath(logoPath) {
  if (!logoPath) return null;
  const lp = path.isAbsolute(logoPath) ? logoPath : path.join(process.cwd(), logoPath);
  return fs.existsSync(lp) ? lp : null;
}

/**
 * @param {import("pdfkit")} doc
 * @param {object} invoice — lean + populated customer
 */
function streamInvoicePdf(doc, invoice) {
  const useDejaVu = fs.existsSync(DEJAVU_SANS) && fs.existsSync(DEJAVU_SANS_BOLD);
  if (useDejaVu) {
    doc.registerFont("DejaVuSans", DEJAVU_SANS);
    doc.registerFont("DejaVuSans-Bold", DEJAVU_SANS_BOLD);
  }
  const sans = useDejaVu ? "DejaVuSans" : "Helvetica";
  const sansBold = useDejaVu ? "DejaVuSans-Bold" : "Helvetica-Bold";

  const co = getCompanyBranding();
  const cust = invoice.customer || {};
  const invNo = invoice.invoiceNumber || String(invoice._id);
  const base = Number(invoice.amount) || 0;
  const cgst = Number(invoice.cgst) || 0;
  const sgst = Number(invoice.sgst) || 0;
  const igst = Number(invoice.igst) || 0;
  const totalTax = cgst + sgst + igst;
  const grand = Number(invoice.totalAmount) || 0;
  const gstType = String(invoice.gstType || "CGST_SGST");

  const margin = doc.page.margins?.left ?? 56;
  const pageW = doc.page.width - margin * 2;
  let y = margin + 4;

  const logoResolved = resolveLogoPath(co.logoPath);
  const logoW = 56;

  if (logoResolved) {
    try {
      doc.image(logoResolved, margin, y, { width: logoW });
    } catch (_e) {
      // ignore
    }
  }

  const textLeft = logoResolved ? margin + logoW + 14 : margin;

  doc.font(sansBold).fontSize(15).fillColor("#0f172a").text(co.name, textLeft, y, { width: pageW - 130 });
  y += 20;
  doc.font(sans).fontSize(8.5).fillColor("#475569");
  for (const line of co.addressLines) {
    doc.text(line, textLeft, y, { width: pageW - 130 });
    y += 11;
  }
  if (co.gstin) {
    doc.text(`GSTIN: ${co.gstin}`, textLeft, y);
    y += 11;
  }
  if (co.phone || co.email) {
    doc.text([co.phone, co.email].filter(Boolean).join(" · "), textLeft, y);
    y += 11;
  }

  const titleY = margin;
  doc.font(sansBold).fontSize(10).fillColor("#64748b").text("TAX INVOICE", margin + pageW - 200, titleY, {
    width: 200,
    align: "right",
  });
  doc.font(sansBold).fontSize(13).fillColor("#0f172a").text(invNo, margin + pageW - 200, titleY + 14, {
    width: 200,
    align: "right",
  });
  doc.font(sans).fontSize(9).fillColor("#64748b").text(
    `Date: ${invoice.createdAt ? new Date(invoice.createdAt).toLocaleDateString("en-IN") : "—"}`,
    margin + pageW - 200,
    titleY + 32,
    { width: 200, align: "right" },
  );
  doc.text(
    `Status: ${String(invoice.status || "").toUpperCase()}`,
    margin + pageW - 200,
    titleY + 46,
    { width: 200, align: "right" },
  );

  y = Math.max(y, titleY + 62) + 18;
  doc.moveTo(margin, y).lineTo(margin + pageW, y).strokeColor("#e2e8f0").lineWidth(1).stroke();
  y += 16;

  doc.font(sansBold).fontSize(9).fillColor("#64748b").text("Bill to", margin, y);
  y += 14;
  doc.font(sansBold).fontSize(11).fillColor("#0f172a").text(cust.name || "Customer", margin, y);
  y += 16;
  doc.font(sans).fontSize(9).fillColor("#334155");
  const addrParts = [
    cust.addressLine1,
    cust.addressLine2,
    [cust.city, cust.state, cust.pincode].filter(Boolean).join(", "),
  ].filter(Boolean);
  for (const a of addrParts) {
    doc.text(a, margin, y, { width: pageW * 0.55 });
    y += 12;
  }
  if (cust.email) {
    doc.text(`Email: ${cust.email}`, margin, y);
    y += 12;
  }
  if (cust.phone) {
    doc.text(`Phone: ${cust.phone}`, margin, y);
    y += 12;
  }
  if (cust.gstin) {
    doc.text(`GSTIN: ${cust.gstin}`, margin, y);
    y += 12;
  }

  y += 10;
  doc.moveTo(margin, y).lineTo(margin + pageW, y).strokeColor("#e2e8f0").lineWidth(1).stroke();
  y += 16;

  const colDesc = margin;
  const colAmt = margin + pageW * 0.42;
  const colTax = margin + pageW * 0.62;
  const colTot = margin + pageW * 0.78;
  const rowH = 22;

  doc.font(sansBold).fontSize(8.5).fillColor("#64748b");
  doc.text("Description", colDesc, y);
  doc.text("Amount", colAmt, y, { width: pageW * 0.18, align: "right" });
  doc.text("Tax", colTax, y, { width: pageW * 0.14, align: "right" });
  doc.text("Total", colTot, y, { width: pageW * 0.22, align: "right" });
  y += rowH;
  doc.moveTo(margin, y).lineTo(margin + pageW, y).strokeColor("#cbd5e1").lineWidth(0.5).stroke();
  y += 10;

  doc.font(sans).fontSize(10).fillColor("#0f172a");
  doc.text(lineDescription(invoice), colDesc, y, { width: pageW * 0.4 });
  doc.text(fmtInr(base), colAmt, y, { width: pageW * 0.18, align: "right" });
  doc.text(fmtInr(totalTax), colTax, y, { width: pageW * 0.14, align: "right" });
  doc.font(sansBold).text(fmtInr(grand), colTot, y, { width: pageW * 0.22, align: "right" });
  y += 28;

  doc.font(sans).fontSize(8.5).fillColor("#64748b").text(`GST type: ${gstType} · Rate: ${Number(invoice.gstRate) || 0}%`, margin, y);
  y += 20;

  doc.font(sansBold).fontSize(9).fillColor("#334155").text("GST breakdown", margin, y);
  y += 14;
  doc.font(sans).fontSize(9).fillColor("#0f172a");
  doc.text(`CGST: ${fmtInr(cgst)}`, margin, y);
  y += 12;
  doc.text(`SGST: ${fmtInr(sgst)}`, margin, y);
  y += 12;
  doc.text(`IGST: ${fmtInr(igst)}`, margin, y);
  y += 12;
  doc.font(sansBold).text(`Total tax: ${fmtInr(totalTax)}`, margin, y);
  y += 20;

  const boxH = 38;
  const boxY = y;
  doc.fillColor("#f1f5f9").roundedRect(margin, boxY, pageW, boxH, 4).fill();
  doc.strokeColor("#0ea5e9").lineWidth(1).roundedRect(margin, boxY, pageW, boxH, 4).stroke();
  doc.fillColor("#0f172a").font(sansBold).fontSize(11);
  doc.text("Grand total (incl. tax)", margin + 12, boxY + 11, { width: pageW * 0.55 });
  doc.fontSize(13).text(fmtInr(grand), colTot - 10, boxY + 8, { width: pageW * 0.35, align: "right" });
  y = boxY + boxH + 24;

  doc.font(sans).fontSize(8).fillColor("#94a3b8").text(
    "This is a system-generated invoice.",
    margin,
    y,
    { width: pageW, align: "center" },
  );
}

module.exports = { streamInvoicePdf };
