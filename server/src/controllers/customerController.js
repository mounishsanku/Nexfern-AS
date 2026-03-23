const Customer = require("../models/Customer");
const { logAction, buildMetadata, ACTIONS } = require("../utils/audit");
const { sendStructuredError, ACTION } = require("../utils/httpErrorResponse");

async function createCustomer(req, res) {
  try {
    const userId = req.user?.sub ?? req.user?.id;
    const { name, email, phone } = req.body ?? {};

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ message: "name is required" });
    }

    const customer = await Customer.create({
      name: name.trim(),
      email: typeof email === "string" ? email.trim().toLowerCase() : null,
      phone: typeof phone === "string" ? phone.trim() : null,
      createdAt: new Date(),
    });

    await logAction(userId, ACTIONS.CREATE, "customer", customer._id, buildMetadata(null, {
      name: customer.name,
      email: customer.email,
    }));

    return res.status(201).json(customer);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return sendStructuredError(res, {
      code: "CUSTOMER_CREATE_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

async function getCustomers(_req, res) {
  try {
    const customers = await Customer.find()
      .sort({ createdAt: -1 })
      .lean();

    return res.json(customers);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err);
    return sendStructuredError(res, {
      code: "CUSTOMER_LIST_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

module.exports = { createCustomer, getCustomers };

