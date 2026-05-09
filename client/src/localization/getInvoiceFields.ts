export function getInvoiceFields(fields: string[]) {
  // Map field names returned from backend pack to input specifications
  const mapped = fields.map((field) => {
    switch (field) {
      case "TRN":
        return {
          id: "customerTRN",
          label: "Customer TRN",
          type: "text",
          placeholder: "15 digit numeric TRN",
          required: false,
        };
      case "placeOfSupply":
        return {
          id: "placeOfSupply",
          label: "Place of Supply",
          type: "text",
          placeholder: "State / Emirate",
          required: false,
        };
      case "GSTIN":
        return {
          id: "customerGSTIN",
          label: "Customer GSTIN",
          type: "text",
          placeholder: "e.g. 27AAAAA0000A1Z5",
          required: false,
        };
      case "HSN":
        return {
          id: "hsnCode",
          label: "HSN / SAC Code",
          type: "text",
          placeholder: "Optional HSN/SAC",
          required: false,
        };
      default:
        return {
          id: field,
          label: field,
          type: "text",
          placeholder: `Enter ${field}`,
          required: false,
        };
    }
  });

  return mapped;
}
