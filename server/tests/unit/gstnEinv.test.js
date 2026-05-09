const axios = require("axios");
const gstnEinvService = require("../../src/services/gstnEinvService");
const mongoose = require("mongoose");

jest.mock("axios");

describe("GstnEinvService", () => {
  const mockEntity = {
    _id: new mongoose.Types.ObjectId(),
    name: "Test Entity",
    gstin: "07AAAAA0000A1Z5",
    eInvoiceConfig: {
      username: "testuser",
      password: "testpassword",
    }
  };

  const mockInvoice = {
    _id: new mongoose.Types.ObjectId(),
    invoiceNumber: "INV-2026-001",
    amount: 1000,
    totalAmount: 1180,
    cgst: 90,
    sgst: 90,
    gstRate: 18,
    customer: {
      name: "Test Customer",
      gstin: "07BBBBB0000B1Z5",
    }
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("successfully generates IRN", async () => {
    axios.post.mockResolvedValueOnce({
      data: {
        status: "1",
        data: {
          Irn: "MOCK_IRN_64_CHAR_HASH",
          SignedQrCode: "MOCK_SIGNED_QR_CODE",
          AckNo: 123456789,
          AckDt: "2026-05-06 10:00:00"
        }
      }
    });

    const result = await gstnEinvService.generateIRN(mockInvoice, mockEntity);

    expect(result.success).toBe(true);
    expect(result.irn).toBe("MOCK_IRN_64_CHAR_HASH");
    expect(result.ackNo).toBe("123456789");
    expect(axios.post).toHaveBeenCalled();
  });

  test("handles GSTN rejection errors", async () => {
    axios.post.mockResolvedValueOnce({
      data: {
        status: "0",
        errorDetails: [
          { error_code: "2150", error_message: "Duplicate IRN" }
        ]
      }
    });

    const result = await gstnEinvService.generateIRN(mockInvoice, mockEntity);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Duplicate IRN");
  });

  test("handles connection failures", async () => {
    axios.post.mockRejectedValueOnce(new Error("Network Error"));

    const result = await gstnEinvService.generateIRN(mockInvoice, mockEntity);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/GSTN Connection Failed/);
  });

  test("returns error if credentials missing", async () => {
    const invalidEntity = { name: "No GSTIN" };
    const result = await gstnEinvService.generateIRN(mockInvoice, invalidEntity);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/GSTIN or e-Invoice credentials missing/);
  });
});
