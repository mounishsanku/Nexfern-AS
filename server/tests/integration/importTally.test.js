const db = require("../setup");
const mongoose = require("mongoose");
const Entity = require("../../src/models/Entity");
const Customer = require("../../src/models/Customer");
const Invoice = require("../../src/models/Invoice");
const Payment = require("../../src/models/Payment");
const { stageImport, executeImport } = require("../../src/services/importEngine");

beforeAll(async () => await db.connect());
afterEach(async () => await db.clearDatabase());
afterAll(async () => await db.closeDatabase());

async function seedBase() {
  const entity = await Entity.create({ name: "Tally Co", country: "IN", baseCurrency: "INR" });
  const customer = await Customer.create({ name: "Acme Tally" });
  return { entity, customer };
}

describe("Tally XML Import", () => {
  test("parses Tally Master XML (Customer)", async () => {
    const { entity } = await seedBase();
    const xml = `
      <ENVELOPE>
        <BODY>
          <DATA>
            <COLLECTION>
              <LEDGER NAME="New Tally Customer">
                <PARENT>Sundry Debtors</PARENT>
                <EMAILID>tally@example.com</EMAILID>
              </LEDGER>
            </COLLECTION>
          </DATA>
        </BODY>
      </ENVELOPE>
    `;

    const job = await stageImport({
      buffer: Buffer.from(xml),
      fileName: "masters.xml",
      entityId: String(entity._id),
      type: "customer",
      source: "tally",
      userId: new mongoose.Types.ObjectId(),
    });

    expect(job.status).toBe("ready");
    expect(job.summary.totalRows).toBe(1);
    expect(job.previewData[0].name).toBe("New Tally Customer");
  });

  test("executes Tally Voucher XML (Invoice + Payment)", async () => {
    const { entity, customer } = await seedBase();
    
    // 1. Create an invoice first (Tally export might have both, but we test linkage)
    const invoice = await Invoice.create({
      customer: customer._id,
      entityId: entity._id,
      amount: 1000,
      totalAmount: 1000,
      paidAmount: 0,
      status: "unpaid",
      date: new Date(),
    });

    const paymentXml = `
      <ENVELOPE>
        <BODY>
          <DATA>
            <COLLECTION>
              <VOUCHER VOUCHERTYPENAME="Payment">
                <PARTYLEDGERNAME>Acme Tally</PARTYLEDGERNAME>
                <AMOUNT>500</AMOUNT>
                <DATE>20260401</DATE>
                <VOUCHERNUMBER>PAY-001</VOUCHERNUMBER>
              </VOUCHER>
            </COLLECTION>
          </DATA>
        </BODY>
      </ENVELOPE>
    `;

    const job = await stageImport({
      buffer: Buffer.from(paymentXml),
      fileName: "vouchers.xml",
      entityId: String(entity._id),
      type: "payment",
      source: "tally",
      userId: new mongoose.Types.ObjectId(),
    });

    expect(job.status).toBe("ready");

    const result = await executeImport(job._id, new mongoose.Types.ObjectId());
    expect(result.status).toBe("completed");
    expect(result.summary.importedRows).toBe(1);

    const payments = await Payment.find({ invoiceId: invoice._id });
    expect(payments.length).toBe(1);
    expect(payments[0].amount).toBe(500);

    const updatedInvoice = await Invoice.findById(invoice._id);
    expect(updatedInvoice.paidAmount).toBe(500);
    expect(updatedInvoice.status).toBe("partially_paid");
  });
});
