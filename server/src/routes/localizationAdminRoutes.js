const express = require("express");
const router = express.Router();
const roleMiddleware = require("../middleware/roleMiddleware");
const Entity = require("../models/Entity");
const Currency = require("../models/Currency");
const ExchangeRate = require("../models/ExchangeRate");
const TaxProfile = require("../models/TaxProfile");
const TaxRule = require("../models/TaxRule");
const LocalizationRegistry = require("../localization/registry/LocalizationRegistry");
const CompanySettings = require("../models/CompanySettings");

// Admin only configuration
router.use(roleMiddleware(["admin"]));

// Entities
router.get("/entities", async (req, res) => {
  const entities = await Entity.find().sort({ createdAt: -1 });
  res.json(entities);
});

router.post("/entities", async (req, res) => {
  const entity = await Entity.create(req.body);
  res.status(201).json(entity);
});

router.put("/entities/:id", async (req, res) => {
  const entity = await Entity.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json(entity);
});

// Currencies
router.get("/currencies", async (req, res) => {
  const items = await Currency.find().sort({ code: 1 });
  res.json(items);
});

router.post("/currencies", async (req, res) => {
  const item = await Currency.findOneAndUpdate({ code: req.body.code }, req.body, { upsert: true, new: true });
  res.json(item);
});

// Exchange Rates
router.get("/exchange-rates", async (req, res) => {
  const items = await ExchangeRate.find().sort({ effectiveDate: -1 });
  res.json(items);
});

router.post("/exchange-rates", async (req, res) => {
  const item = await ExchangeRate.create(req.body);
  res.status(201).json(item);
});

// Tax Profiles
router.get("/tax-profiles", async (req, res) => {
  const profiles = await TaxProfile.find().populate("taxRules").populate("entityId", "name country");
  res.json(profiles);
});

router.post("/tax-profiles", async (req, res) => {
  const profile = await TaxProfile.create(req.body);
  res.status(201).json(profile);
});

// Tax Rules
router.post("/tax-rules", async (req, res) => {
  const rule = await TaxRule.create(req.body);
  if (req.body.profileId) {
    await TaxProfile.findByIdAndUpdate(req.body.profileId, { $push: { taxRules: rule._id } });
  }
  res.status(201).json(rule);
});

// Localization Context Helper
router.get("/localization-context", async (req, res) => {
  const settings = await CompanySettings.findOne();
  if (!settings) return res.status(404).json({ error: "Company settings not found" });
  
  let entityId = req.query.entityId || settings.defaultEntityId;
  let activeEntity = await Entity.findById(entityId);
  if (!activeEntity) {
    activeEntity = await Entity.findOne();
  }

  let metadata = null;
  let invoiceFields = [];
  if (activeEntity) {
    try {
      const pack = LocalizationRegistry.get(activeEntity.country);
      metadata = pack.getCountryMetadata();
      invoiceFields = pack.getInvoiceFields ? pack.getInvoiceFields() : [];
    } catch (e) {
      // Pack not found
    }
  }

  res.json({
    activeEntity,
    metadata,
    invoiceFields,
    features: settings.features || {}
  });
});

module.exports = router;
