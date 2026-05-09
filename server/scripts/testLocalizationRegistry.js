const LocalizationRegistry = require("../src/localization/registry/LocalizationRegistry");

console.log("--- Testing Localization Registry ---");

try {
  // Test 1: India Pack Resolves
  const inPack1 = LocalizationRegistry.get("IN");
  console.log("✅ IN pack resolved.");
  console.log("   Tax Type:", inPack1.getTaxType());
  console.log("   Reports:", inPack1.getReports().join(", "));

  // Test 2: Singleton Behavior
  const inPack2 = LocalizationRegistry.get("IN");
  if (inPack1 === inPack2) {
    console.log("✅ Singleton caching behavior works (same instance).");
  } else {
    console.error("❌ Singleton caching failed!");
  }

  // Test 3: UAE Pack Resolves
  const aePack = LocalizationRegistry.get("AE");
  console.log("✅ AE pack resolved.");
  console.log("   Tax Type:", aePack.getTaxType());
  console.log("   Fields:", aePack.getInvoiceFields().join(", "));

  // Test 4: Unsupported Country Throws Clean Error
  try {
    LocalizationRegistry.get("SG");
    console.error("❌ Expected error for SG pack, but it resolved.");
  } catch (error) {
    if (error.message.includes("Unsupported localization pack: SG")) {
      console.log("✅ Unsupported country threw explicit error:", error.message);
    } else {
      console.error("❌ Unexpected error thrown:", error.message);
    }
  }

} catch (e) {
  console.error("Validation Script Failed:", e);
  process.exit(1);
}

console.log("--- Tests completed successfully ---");
