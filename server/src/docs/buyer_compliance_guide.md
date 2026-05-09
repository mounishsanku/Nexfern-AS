# Nexfern FinanceOS: e-Invoicing Compliance Guide

This guide outlines how Nexfern FinanceOS handles e-Invoicing compliance for the Indian market, integrating directly with the IRP (Invoice Registration Portal).

## 1. Prerequisites
To use e-Invoicing, your entity must have:
*   A valid GSTIN.
*   API credentials generated via the GST Portal (Sandbox or Production).
*   Configured credentials in **Entity Settings** within Nexfern.

## 2. Configuration
Navigate to **Settings > Entity Settings** and populate the following fields for your Indian entity:
*   **GSTIN**: Your 15-digit Tax Identification Number.
*   **e-Invoice Username**: The username created on the e-Invoice portal.
*   **e-Invoice Password**: The API password.
*   **Client ID / Secret**: Provided by your GSP or directly from NIC.

## 3. Workflow
1.  **Create Invoice**: Generate a B2B invoice as usual.
2.  **Generate IRN**: On the invoice list, click the **Generate IRN** button.
3.  **Submission**: Nexfern submits the invoice data to the NIC Sandbox (NIC Schema 1.1).
4.  **Verification**: Upon success, Nexfern stores the:
    *   **IRN** (64-character hash)
    *   **Acknowledgment Number & Date**
    *   **Signed QR Code**
5.  **Visual Proof**: The QR code is automatically embedded in the Invoice PDF (upcoming) and visible in the UI.

## 4. Troubleshooting
If an e-invoice fails:
*   **Duplicate IRN**: This occurs if the same invoice number was already submitted.
*   **Validation Error**: Ensure Customer GSTIN and Address (including Pin Code) are correct.
*   **Authentication Failed**: Verify your API credentials and ensure the account is not locked on the NIC portal.

## 5. GST Reconciliation (GSTR-2A/2B)
Nexfern provides a robust auto-matching engine to reconcile your book expenses with data from the GST Portal.

### Workflow
1.  **Download JSON**: Export your GSTR-2B or GSTR-2A JSON file from the GST portal.
2.  **Upload to Nexfern**: Navigate to **GST Recon** and upload the JSON file.
3.  **Auto-Matching**: The system matches portal records to your **Expenses** using:
    *   **Vendor GSTIN**
    *   **Invoice Number** (Fuzzy matching handles common prefix/suffix differences)
    *   **Amount** (Auto-flags discrepancies > ₹1.00)
4.  **Discrepancy Reporting**:
    *   **Matched**: Data in books aligns with portal data.
    *   **Discrepancy**: Record exists in both, but amounts differ (possible ITC leakage).
    *   **Missing in Books**: Record exists in portal but not in Nexfern (Unclaimed ITC).
    *   **Unclaimed in Portal**: Expense in books but not in portal (Vendor hasn't filed GSTR-1).

## 6. Sandbox Details
Nexfern currently integrates with the **NIC Sandbox**:
*   **URL**: `https://einv-apisandbox.nic.in/einvapi`
*   **Environment**: Test / Mock data only.

---
*Disclaimer: This documentation is for informational purposes only. Consult with a tax professional for specific compliance advice.*
