require("dotenv").config();
const { connectDb } = require("../src/config/db");
const ExchangeRate = require("../src/models/ExchangeRate");

async function run() {
  await connectDb();

  const rates = [
    { fromCurrency: "USD", toCurrency: "INR", rate: 83.50, effectiveDate: new Date("2026-01-01") },
    { fromCurrency: "INR", toCurrency: "USD", rate: 1 / 83.50, effectiveDate: new Date("2026-01-01") },
    { fromCurrency: "AED", toCurrency: "USD", rate: 0.27, effectiveDate: new Date("2026-01-01") },
    { fromCurrency: "USD", toCurrency: "AED", rate: 3.67, effectiveDate: new Date("2026-01-01") },
    { fromCurrency: "AED", toCurrency: "INR", rate: 22.73, effectiveDate: new Date("2026-01-01") },
    { fromCurrency: "INR", toCurrency: "AED", rate: 1 / 22.73, effectiveDate: new Date("2026-01-01") },
  ];

  for (const r of rates) {
    await ExchangeRate.findOneAndUpdate(
      { fromCurrency: r.fromCurrency, toCurrency: r.toCurrency, effectiveDate: r.effectiveDate },
      r,
      { upsert: true, new: true }
    );
    console.log(`Seeded rate: ${r.fromCurrency} -> ${r.toCurrency} @ ${r.rate}`);
  }

  console.log("Exchange rates seeding complete.");
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
