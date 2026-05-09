const axios = require("axios");
const logger = require("../utils/logger");

/**
 * GstnEinvService - Handles integration with Indian GSTN e-Invoicing API.
 * Sandbox URL: https://einv-apisandbox.nic.in/einvapi
 * Specification: Version 1.03
 */
class GstnEinvService {
  constructor() {
    this.baseUrl = process.env.GSTN_EINV_URL || "https://einv-apisandbox.nic.in/einvapi";
  }

  /**
   * Main entry point to generate IRN for a Nexfern Invoice.
   */
  async generateIRN(invoice, entity) {
    try {
      if (!entity.gstin || !entity.eInvoiceConfig?.username) {
        throw new Error("GSTIN or e-Invoice credentials missing in Entity configuration");
      }

      // 1. Authenticate (Get Session Token)
      const authToken = await this.authenticate(entity);

      // 2. Prepare GSTN Payload (Schema 1.1)
      const payload = this.preparePayload(invoice, entity);

      // 3. Submit to GSTN
      logger.info("gstn: submitting e-invoice", { invoiceId: invoice._id, gstin: entity.gstin });
      
      let data;
      if (authToken === "demo-sandbox-token-12345") {
        data = {
          status: "1",
          data: {
            Irn: "MOCKIRN" + Date.now().toString() + "1234",
            SignedQrCode: "MOCK_QR_CODE_DATA",
            AckNo: 123456789012,
            AckDt: new Date().toISOString().slice(0, 19).replace('T', ' ')
          }
        };
      } else {
        const response = await axios.post(`${this.baseUrl}/v1.03/Invoice`, payload, {
          headers: {
            "Content-Type": "application/json",
            "user_name": entity.eInvoiceConfig.username,
            "auth-token": authToken,
            "gstin": entity.gstin
          }
        });
        data = response.data;
      }
      if (data.status === "1") {
        // Success
        return {
          success: true,
          irn: data.data.Irn,
          qrCode: data.data.SignedQrCode,
          ackNo: String(data.data.AckNo),
          ackDate: data.data.AckDt
        };
      } else {
        // Business Error (e.g. invalid GSTIN, duplicate IRN)
        const errorMessage = data.errorDetails?.[0]?.error_message || "Unknown GSTN error";
        logger.error("gstn: e-invoice rejection", { invoiceId: invoice._id, error: data.errorDetails });
        return { success: false, error: errorMessage };
      }

    } catch (err) {
      const message = err.response?.data?.errorDetails?.[0]?.error_message || err.message;
      logger.error("gstn: e-invoice connection error", { error: message });
      return { success: false, error: `GSTN Connection Failed: ${message}` };
    }
  }

  /**
   * Prepare payload according to NIC Schema 1.1
   */
  preparePayload(invoice, entity) {
    // Note: This is a simplified mapping. Real-world mapping requires 100+ fields.
    return {
      "Version": "1.1",
      "TranDtls": {
        "TaxSch": "GST",
        "SupTyp": "B2B", // Defaulting to B2B
        "RegRev": "N",
        "EcmGstin": null,
        "IgstOnIntra": "N"
      },
      "DocDtls": {
        "Typ": "INV",
        "No": invoice.invoiceNumber || String(invoice._id).substring(0, 16),
        "Dt": this.formatDate(invoice.date || invoice.createdAt)
      },
      "SellerDtls": {
        "Gstin": entity.gstin,
        "LglNm": entity.name,
        "TrdNm": entity.name,
        "Addr1": "Company Address", // Should be pulled from Entity settings
        "Loc": "City",
        "Pin": 110001,
        "Stcd": "07"
      },
      "BuyerDtls": {
        "Gstin": invoice.customer?.gstin || "URP", // Unregistered if missing
        "LglNm": invoice.customer?.name || "Cash Customer",
        "TrdNm": invoice.customer?.name || "Cash Customer",
        "Pos": "07",
        "Addr1": "Buyer Address",
        "Loc": "City",
        "Pin": 110001,
        "Stcd": "07"
      },
      "ItemList": [
        {
          "SlNo": "1",
          "PrdNm": "Consulting Services",
          "PrdDesc": "Consulting Services",
          "HsnCd": "9983",
          "Qty": 1,
          "Unit": "OTH",
          "UnitPrice": invoice.amount,
          "TotAmt": invoice.amount,
          "Discount": 0,
          "PreTaxVal": 0,
          "AssAmt": invoice.amount,
          "GstRt": invoice.gstRate || 0,
          "IgstAmt": invoice.igst || 0,
          "CgstAmt": invoice.cgst || 0,
          "SgstAmt": invoice.sgst || 0,
          "CesRt": 0,
          "CesAmt": 0,
          "CesNonAdvlAmt": 0,
          "StateCesRt": 0,
          "StateCesAmt": 0,
          "TotItemVal": invoice.totalAmount
        }
      ],
      "ValDtls": {
        "AssVal": invoice.amount,
        "CgstVal": invoice.cgst || 0,
        "SgstVal": invoice.sgst || 0,
        "IgstVal": invoice.igst || 0,
        "CesVal": 0,
        "StCesVal": 0,
        "Discount": 0,
        "OthChrg": 0,
        "RndOffAmt": 0,
        "TotInvVal": invoice.totalAmount
      }
    };
  }

  /**
   * Authenticate with GSTN
   */
  async authenticate(entity) {
    if (process.env.NODE_ENV === "demo") {
      return "demo-sandbox-token-12345";
    }
    if (["test", "development"].includes(process.env.NODE_ENV) || !entity.eInvoiceConfig?.password) {
      return "mock-sandbox-token-12345";
    }

    try {
      const response = await axios.post(`${this.baseUrl}/v1.03/Authenticate`, {
        "UserName": entity.eInvoiceConfig.username,
        "Password": entity.eInvoiceConfig.password,
        "AppKey": entity.eInvoiceConfig.appKey,
        "ForceRefreshAccessToken": false
      });
      return response.data.data.AuthToken;
    } catch (err) {
      logger.error("gstn: auth failed", { error: err.message });
      throw new Error("GSTN Authentication Failed");
    }
  }

  formatDate(date) {
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    return `${day}/${month}/${year}`;
  }
}

module.exports = new GstnEinvService();
