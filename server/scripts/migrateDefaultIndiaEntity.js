const mongoose = require("mongoose");
require("dotenv").config();

// Assuming this script runs from server/scripts directory
const { connectDb } = require("../src/config/db");

const Entity = require("../src/models/Entity");
const CompanySettings = require("../src/models/CompanySettings");
const Invoice = require("../src/models/Invoice");
const Expense = require("../src/models/Expense");
const Payment = require("../src/models/Payment");
const Voucher = require("../src/models/Voucher");
const Payslip = require("../src/models/Payslip");
const BankTransaction = require("../src/models/BankTransaction");
const VoucherEntry = require("../src/models/VoucherEntry");

async function runMigration() {
  try {
    await connectDb();
    console.log("Starting Phase 1 Globalization Migration...");

    // 1. Create or Find Default India Entity
    let defaultEntity = await Entity.findOne({ country: "IN", name: "Default India Entity" });
    if (!defaultEntity) {
      defaultEntity = new Entity({
        name: "Default India Entity",
        country: "IN",
        baseCurrency: "INR",
        fiscalYearStartMonth: 4,
      });
      await defaultEntity.save();
      console.log(`Created Default India Entity: ${defaultEntity._id}`);
    } else {
      console.log(`Found existing Default India Entity: ${defaultEntity._id}`);
    }

    // 2. Create or Update CompanySettings (Singleton)
    let settings = await CompanySettings.findOne();
    if (!settings) {
      settings = new CompanySettings({
        defaultEntityId: defaultEntity._id,
        defaultCurrency: "INR",
        features: { USE_NEW_LOCALIZATION_ENGINE: false },
      });
      await settings.save();
      console.log("Created CompanySettings singleton.");
    } else {
      if (!settings.defaultEntityId) {
        settings.defaultEntityId = defaultEntity._id;
        await settings.save();
        console.log("Updated CompanySettings with defaultEntityId.");
      } else {
        console.log("CompanySettings already configured.");
      }
    }

    // 3. Backfill collections with entityId
    const modelsToBackfillEntityId = [
      { name: "Invoice", model: Invoice },
      { name: "Expense", model: Expense },
      { name: "Payment", model: Payment },
      { name: "Voucher", model: Voucher },
      { name: "Payslip", model: Payslip },
      { name: "BankTransaction", model: BankTransaction },
    ];

    for (const { name, model } of modelsToBackfillEntityId) {
      // Find records missing entityId
      const records = await model.find({ entityId: null });
      if (records.length > 0) {
        let updatedCount = 0;
        // READ -> VERIFY -> UPDATE
        for (const record of records) {
          if (!record.entityId) {
            record.entityId = defaultEntity._id;
            await record.save();
            updatedCount++;
          }
        }
        console.log(`Backfilled entityId for ${updatedCount} ${name} records.`);
      } else {
        console.log(`No ${name} records needed entityId backfill.`);
      }
    }

    // 4. Backfill Invoice currency and baseAmount
    const invoices = await Invoice.find({
      $or: [
        { currency: null },
        { currency: "INR", exchangeRate: null }, // Handle if default is applied but we need save
        { baseAmount: null }
      ]
    });

    if (invoices.length > 0) {
      let updatedCount = 0;
      for (const inv of invoices) {
        let needsSave = false;
        if (!inv.currency) {
          inv.currency = "INR";
          inv.exchangeRate = 1;
          needsSave = true;
        }
        if (inv.baseAmount == null) {
          // Invoice baseAmount = totalAmount || amount
          inv.baseAmount = inv.totalAmount || inv.amount || 0;
          needsSave = true;
        }
        if (needsSave) {
          await inv.save();
          updatedCount++;
        }
      }
      console.log(`Backfilled currency/baseAmount for ${updatedCount} Invoice records.`);
    } else {
      console.log("No Invoice records needed currency/baseAmount backfill.");
    }

    // 5. Backfill VoucherEntry currency and baseAmount
    const voucherEntries = await VoucherEntry.find({
      $or: [
        { currency: null },
        { baseAmount: null }
      ]
    });

    if (voucherEntries.length > 0) {
      let updatedCount = 0;
      for (const entry of voucherEntries) {
        let needsSave = false;
        if (!entry.currency) {
          entry.currency = "INR";
          needsSave = true;
        }
        if (entry.baseAmount == null) {
          // VoucherEntry has debit/credit
          const amount = entry.debit > 0 ? entry.debit : entry.credit;
          entry.baseAmount = amount || 0;
          needsSave = true;
        }
        if (needsSave) {
          await entry.save();
          updatedCount++;
        }
      }
      console.log(`Backfilled currency/baseAmount for ${updatedCount} VoucherEntry records.`);
    } else {
      console.log("No VoucherEntry records needed currency/baseAmount backfill.");
    }

    console.log("Migration completed successfully.");
    process.exit(0);

  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

runMigration();
