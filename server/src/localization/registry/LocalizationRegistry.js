class LocalizationRegistry {
  constructor() {
    this.packs = new Map();
  }

  get(countryCode) {
    const code = (countryCode || "IN").toUpperCase();

    if (this.packs.has(code)) {
      return this.packs.get(code);
    }

    let pack;
    // Lazy loading strategy via dynamic require to avoid circular dependencies
    if (code === "IN") {
      const IndiaPackService = require("../packs/IndiaPackService");
      pack = new IndiaPackService();
    } else if (code === "AE") {
      const UaePackService = require("../packs/UaePackService");
      pack = new UaePackService();
    } else {
      throw new Error(`Unsupported localization pack: ${code}`);
    }

    this.packs.set(code, pack);
    return pack;
  }

  getTaxLiabilityAccount(countryCode) {
    try {
      const pack = this.get(countryCode);
      if (pack && typeof pack.getTaxLiabilityAccount === "function") {
        return pack.getTaxLiabilityAccount();
      }
    } catch (e) {
      // Ignore if pack not found
    }
    return "GST Payable"; // Default for legacy compatibility
  }

  register(countryCode, service) {
    const code = countryCode.toUpperCase();
    this.packs.set(code, service);
  }
}

// Singleton-safe instance
const instance = new LocalizationRegistry();

module.exports = instance;
