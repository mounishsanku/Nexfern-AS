const request = require("supertest");
const mongoose = require("mongoose");
const { connectDb } = require("../../src/config/db");
const GstReconciliationJob = require("../../src/models/GstReconciliationJob");
const GstPortalPurchase = require("../../src/models/GstPortalPurchase");
const Expense = require("../../src/models/Expense");
const Vendor = require("../../src/models/Vendor");
const User = require("../../src/models/User");
const Entity = require("../../src/models/Entity");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "super_secret_test_key_long_enough";
const app = require("../../src/index");

const { connect, closeDatabase, clearDatabase } = require("../setup");

describe("GST Reconciliation Integration", () => {
  let token;
  let entityId;
  let vendorId;

  beforeAll(async () => {
    await connect();
  });

  beforeEach(async () => {
    await clearDatabase();
    
    // Setup Test Entity
    const entity = await Entity.create({
      name: "GST Recon Test Entity",
      country: "IN",
      baseCurrency: "INR"
    });
    entityId = entity._id;

    // Setup Test User
    const user = await User.create({
      name: "Admin User",
      email: "admin-gst@example.com",
      password: "password123",
      role: "admin"
    });
    token = jwt.sign({ sub: user._id, role: user.role }, process.env.JWT_SECRET || "secret");

    // Setup Test Vendor
    const vendor = await Vendor.create({
      name: "Portal Vendor",
      gstNumber: "07AAAAA0000A1Z5"
    });
    vendorId = vendor._id;

    // Setup Test Expense (Matched)
    await Expense.create({
      title: "Matched Expense",
      amount: 1000,
      totalAmount: 1180,
      invoiceNumber: "INV-101",
      vendorId,
      entityId,
      category: "other"
    });

    // Setup Test Expense (Discrepancy)
    await Expense.create({
      title: "Discrepancy Expense",
      amount: 1700,
      totalAmount: 2000,
      invoiceNumber: "INV-102",
      vendorId,
      entityId,
      category: "other"
    });
  });

  afterAll(async () => {
    await closeDatabase();
  });

  test("POST /api/gst/reconciliation/upload - successfully processes GSTR-2B JSON", async () => {
    const mockGstrJson = {
      data: {
        doclist: [
          {
            b2b: [
              {
                ctin: "07AAAAA0000A1Z5",
                inv: [
                  { inum: "INV-101", val: 1000, ctax: 90, stax: 90, itax: 0 }, // Should Match
                  { inum: "INV-102", val: 1500, ctax: 135, stax: 135, itax: 0 }, // Should Discrepancy (Total 1770 vs 2000)
                  { inum: "INV-103", val: 500, ctax: 45, stax: 45, itax: 0 } // Should Missing in Books
                ]
              }
            ]
          }
        ]
      }
    };

    const response = await request(app)
      .post("/api/gst/reconciliation/upload")
      .set("Authorization", `Bearer ${token}`)
      .field("entityId", entityId.toString())
      .field("sourceType", "2B")
      .attach("file", Buffer.from(JSON.stringify(mockGstrJson)), "gstr2b.json");

    expect(response.status).toBe(201);
    expect(response.body.status).toBe("pending");
    
    const jobId = response.body._id;

    // Wait for async processing (In a real test, we might use a sync call or wait)
    // For this test, we'll manually call the service or check DB after a delay
    const gstReconciliationService = require("../../src/services/gstReconciliationService");
    await gstReconciliationService.processJob(jobId);

    const updatedJob = await GstReconciliationJob.findById(jobId);
    expect(updatedJob.status).toBe("completed");
    expect(updatedJob.summary.matchedRows).toBe(1);
    expect(updatedJob.summary.discrepancyRows).toBe(1);
    expect(updatedJob.summary.missingInBooksRows).toBe(1);

    const portalRows = await GstPortalPurchase.find({ jobId });
    const matchedRow = portalRows.find(r => r.invoiceNumber === "INV-101");
    expect(matchedRow.matchStatus).toBe("matched");
    expect(matchedRow.matchedExpenseId).not.toBeNull();

    const discrepancyRow = portalRows.find(r => r.invoiceNumber === "INV-102");
    expect(discrepancyRow.matchStatus).toBe("discrepancy");
    expect(discrepancyRow.discrepancyNote).toMatch(/Amount mismatch/);
  });
});
