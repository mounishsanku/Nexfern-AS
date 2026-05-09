require("dotenv").config();
const { connectDb } = require("../src/config/db");
const Currency = require("../src/models/Currency");
const mongoose = require("mongoose");

async function run() {
  await connectDb();

  const currencies = [
    { code: "INR", name: "Indian Rupee", symbol: "₹", decimals: 2 },
    { code: "USD", name: "US Dollar", symbol: "$", decimals: 2 },
    { code: "AED", name: "UAE Dirham", symbol: "د.إ", decimals: 2 },
  ];

  for (const c of currencies) {
    await Currency.findOneAndUpdate({ code: c.code }, c, { upsert: true, new: true });
    console.log(`Seeded currency: ${c.code}`);
  }

  console.log("Currency seeding complete.");
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
