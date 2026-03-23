const Vendor = require("../models/Vendor");
const { logAction, buildMetadata, ACTIONS } = require("../utils/audit");
const { sendStructuredError, ACTION } = require("../utils/httpErrorResponse");

async function createVendor(req, res) {
  try {
    const userId = req.user?.sub ?? req.user?.id;
    const { name, email, phone, gstNumber } = req.body ?? {};
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ message: "name is required" });
    }
    const vendor = await Vendor.create({
      name:      name.trim(),
      email:     email?.trim()     || null,
      phone:     phone?.trim()     || null,
      gstNumber: gstNumber?.trim() || null,
    });
    await logAction(userId, ACTIONS.CREATE, "vendor", vendor._id, buildMetadata(null, { name: vendor.name }));
    return res.status(201).json(vendor);
  } catch (err) {
    console.error("createVendor error:", err);
    return sendStructuredError(res, {
      code: "VENDOR_CREATE_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

async function listVendors(req, res) {
  try {
    const vendors = await Vendor.find().sort({ name: 1 }).lean();
    return res.json(vendors);
  } catch (err) {
    console.error("listVendors error:", err);
    return sendStructuredError(res, {
      code: "VENDOR_LIST_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

module.exports = { createVendor, listVendors };
