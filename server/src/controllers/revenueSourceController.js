const mongoose = require("mongoose");
const { sendStructuredError, ACTION } = require("../utils/httpErrorResponse");
const Project = require("../models/Project");
const Batch = require("../models/Batch");
const Event = require("../models/Event");
const { createInvoiceFromData } = require("./invoiceController");

function makeLocalId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function createProject(req, res) {
  try {
    const { name, clientId, totalValue, milestones = [] } = req.body ?? {};
    if (!name || !clientId) return res.status(400).json({ message: "name and clientId are required" });
    if (!mongoose.Types.ObjectId.isValid(clientId)) return res.status(400).json({ message: "invalid clientId" });
    const total = Number(totalValue);
    if (!Number.isFinite(total) || total < 0) return res.status(400).json({ message: "totalValue must be >= 0" });

    const normalizedMilestones = Array.isArray(milestones)
      ? milestones.map((m) => ({
          id: String(m?.id || makeLocalId("ms")).trim(),
          name: String(m?.name || "").trim(),
          amount: Number(m?.amount) || 0,
          isCompleted: Boolean(m?.isCompleted),
          invoiceId: null,
        }))
      : [];

    const project = await Project.create({
      name: String(name).trim(),
      clientId,
      totalValue: total,
      milestones: normalizedMilestones,
    });
    return res.status(201).json(project);
  } catch (err) {
    console.error("createProject error:", err);
    return sendStructuredError(res, {
      code: "REVENUE_SOURCE_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

async function listProjects(_req, res) {
  try {
    const rows = await Project.find().populate("clientId", "name").sort({ createdAt: -1 }).lean();
    return res.json(rows);
  } catch (err) {
    console.error("listProjects error:", err);
    return sendStructuredError(res, {
      code: "REVENUE_SOURCE_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

async function completeProjectMilestone(req, res) {
  try {
    const { id, milestoneId } = req.params ?? {};
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: "invalid project id" });

    const project = await Project.findById(id).lean();
    if (!project) return res.status(404).json({ message: "Project not found" });

    const index = Array.isArray(project.milestones)
      ? project.milestones.findIndex((m) => String(m.id) === String(milestoneId))
      : -1;
    if (index < 0) return res.status(404).json({ message: "Milestone not found" });

    const milestone = project.milestones[index];
    if (milestone.isCompleted && milestone.invoiceId) {
      return res.status(400).json({ message: "Milestone already completed and invoiced" });
    }
    if (!Number.isFinite(Number(milestone.amount)) || Number(milestone.amount) <= 0) {
      return res.status(400).json({ message: "Milestone amount must be greater than 0" });
    }

    const userId = req.user?.sub ?? req.user?.id;
    const invoice = await createInvoiceFromData({
      userId,
      customerId: String(project.clientId),
      amount: Number(milestone.amount),
      gstRate: 0,
      gstType: "CGST_SGST",
      isDeferred: false,
      deferredMonths: null,
      revenueType: "project",
      projectId: project._id,
      milestoneId: String(milestone.id),
      financialYearId: req.activeYear?._id ?? null,
    });

    await Project.updateOne(
      { _id: project._id, "milestones.id": String(milestone.id) },
      {
        $set: {
          "milestones.$.isCompleted": true,
          "milestones.$.invoiceId": invoice._id,
        },
      }
    );

    return res.status(201).json({ message: "Milestone completed and invoiced", invoiceId: invoice._id });
  } catch (err) {
    console.error("completeProjectMilestone error:", err);
    if (String(err?.message || "").includes("must be")) {
      return res.status(400).json({ message: err.message });
    }
    return sendStructuredError(res, {
      code: "REVENUE_SOURCE_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

async function createBatch(req, res) {
  try {
    const { name, course, fee, students = [] } = req.body ?? {};
    if (!name || !course) return res.status(400).json({ message: "name and course are required" });
    const parsedFee = Number(fee);
    if (!Number.isFinite(parsedFee) || parsedFee < 0) return res.status(400).json({ message: "fee must be >= 0" });

    const batch = await Batch.create({
      name: String(name).trim(),
      course: String(course).trim(),
      fee: parsedFee,
      students: Array.isArray(students)
        ? students
            .map((s) => {
              if (typeof s === "string") {
                return {
                  id: makeLocalId("stu"),
                  name: s.trim(),
                  email: null,
                  customerId: null,
                  isPaid: false,
                  lastInvoiceId: null,
                };
              }
              return {
                id: String(s?.id || makeLocalId("stu")).trim(),
                name: String(s?.name || "").trim(),
                email: s?.email ? String(s.email).trim().toLowerCase() : null,
                customerId: mongoose.Types.ObjectId.isValid(s?.customerId) ? s.customerId : null,
                isPaid: Boolean(s?.isPaid),
                lastInvoiceId: null,
              };
            })
            .filter((s) => s.name)
        : [],
    });
    return res.status(201).json(batch);
  } catch (err) {
    console.error("createBatch error:", err);
    return sendStructuredError(res, {
      code: "REVENUE_SOURCE_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

async function listBatches(_req, res) {
  try {
    const rows = await Batch.find().sort({ createdAt: -1 }).lean();
    return res.json(rows);
  } catch (err) {
    console.error("listBatches error:", err);
    return sendStructuredError(res, {
      code: "REVENUE_SOURCE_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

async function addBatchStudent(req, res) {
  try {
    const { id } = req.params ?? {};
    const { name, email, customerId } = req.body ?? {};
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: "invalid batch id" });
    if (!name || !customerId) return res.status(400).json({ message: "name and customerId are required" });
    if (!mongoose.Types.ObjectId.isValid(customerId)) return res.status(400).json({ message: "invalid customerId" });

    const student = {
      id: makeLocalId("stu"),
      name: String(name).trim(),
      email: email ? String(email).trim().toLowerCase() : null,
      customerId,
      isPaid: false,
      lastInvoiceId: null,
    };

    await Batch.updateOne({ _id: id }, { $push: { students: student } });
    return res.status(201).json(student);
  } catch (err) {
    console.error("addBatchStudent error:", err);
    return sendStructuredError(res, {
      code: "REVENUE_SOURCE_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

async function payBatchStudent(req, res) {
  try {
    const { id, studentId } = req.params ?? {};
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: "invalid batch id" });

    const batch = await Batch.findById(id).lean();
    if (!batch) return res.status(404).json({ message: "Batch not found" });
    const student = Array.isArray(batch.students) ? batch.students.find((s) => String(s.id) === String(studentId)) : null;
    if (!student) return res.status(404).json({ message: "Student not found" });
    if (student.isPaid) return res.status(400).json({ message: "Student already marked as paid" });
    if (!student.customerId || !mongoose.Types.ObjectId.isValid(student.customerId)) {
      return res.status(400).json({ message: "Student is missing a valid customerId" });
    }

    const userId = req.user?.sub ?? req.user?.id;
    const invoice = await createInvoiceFromData({
      userId,
      customerId: String(student.customerId),
      amount: Number(batch.fee),
      gstRate: 0,
      gstType: "CGST_SGST",
      isDeferred: false,
      deferredMonths: null,
      revenueType: "academy",
      batchId: batch._id,
      batchStudentId: String(student.id),
      financialYearId: req.activeYear?._id ?? null,
    });

    await Batch.updateOne(
      { _id: batch._id, "students.id": String(student.id) },
      { $set: { "students.$.isPaid": true, "students.$.lastInvoiceId": invoice._id } }
    );

    return res.status(201).json({ message: "Student payment invoiced", invoiceId: invoice._id });
  } catch (err) {
    console.error("payBatchStudent error:", err);
    if (String(err?.message || "").includes("must be")) {
      return res.status(400).json({ message: err.message });
    }
    return sendStructuredError(res, {
      code: "REVENUE_SOURCE_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

async function createEvent(req, res) {
  try {
    const { name, ticketPrice, attendees = [] } = req.body ?? {};
    if (!name) return res.status(400).json({ message: "name is required" });
    const price = Number(ticketPrice);
    if (!Number.isFinite(price) || price < 0) return res.status(400).json({ message: "ticketPrice must be >= 0" });

    const event = await Event.create({
      name: String(name).trim(),
      ticketPrice: price,
      attendees: Array.isArray(attendees)
        ? attendees
            .map((a) => {
              if (typeof a === "string") {
                return {
                  id: makeLocalId("att"),
                  name: a.trim(),
                  email: null,
                  customerId: null,
                  invoiceId: null,
                };
              }
              return {
                id: String(a?.id || makeLocalId("att")).trim(),
                name: String(a?.name || "").trim(),
                email: a?.email ? String(a.email).trim().toLowerCase() : null,
                customerId: mongoose.Types.ObjectId.isValid(a?.customerId) ? a.customerId : null,
                invoiceId: null,
              };
            })
            .filter((a) => a.name)
        : [],
    });
    return res.status(201).json(event);
  } catch (err) {
    console.error("createEvent error:", err);
    return sendStructuredError(res, {
      code: "REVENUE_SOURCE_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

async function listEvents(_req, res) {
  try {
    const rows = await Event.find().sort({ createdAt: -1 }).lean();
    return res.json(rows);
  } catch (err) {
    console.error("listEvents error:", err);
    return sendStructuredError(res, {
      code: "REVENUE_SOURCE_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

async function buyEventTicket(req, res) {
  try {
    const { id } = req.params ?? {};
    const { name, email, customerId } = req.body ?? {};
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: "invalid event id" });
    if (!name || !customerId) return res.status(400).json({ message: "name and customerId are required" });
    if (!mongoose.Types.ObjectId.isValid(customerId)) return res.status(400).json({ message: "invalid customerId" });

    const event = await Event.findById(id).lean();
    if (!event) return res.status(404).json({ message: "Event not found" });
    if (!Number.isFinite(Number(event.ticketPrice)) || Number(event.ticketPrice) <= 0) {
      return res.status(400).json({ message: "ticketPrice must be greater than 0" });
    }

    const attendeeId = makeLocalId("att");
    const userId = req.user?.sub ?? req.user?.id;
    const invoice = await createInvoiceFromData({
      userId,
      customerId: String(customerId),
      amount: Number(event.ticketPrice),
      gstRate: 0,
      gstType: "CGST_SGST",
      isDeferred: false,
      deferredMonths: null,
      revenueType: "event",
      eventId: event._id,
      financialYearId: req.activeYear?._id ?? null,
    });

    await Event.updateOne(
      { _id: event._id },
      {
        $push: {
          attendees: {
            id: attendeeId,
            name: String(name).trim(),
            email: email ? String(email).trim().toLowerCase() : null,
            customerId,
            invoiceId: invoice._id,
          },
        },
      }
    );

    return res.status(201).json({ message: "Ticket purchase invoiced", invoiceId: invoice._id });
  } catch (err) {
    console.error("buyEventTicket error:", err);
    if (String(err?.message || "").includes("must be")) {
      return res.status(400).json({ message: err.message });
    }
    return sendStructuredError(res, {
      code: "REVENUE_SOURCE_FAILED",
      message: "Something went wrong",
      action: ACTION.RETRY,
    });
  }
}

module.exports = {
  createProject,
  listProjects,
  completeProjectMilestone,
  createBatch,
  listBatches,
  addBatchStudent,
  payBatchStudent,
  createEvent,
  listEvents,
  buyEventTicket,
};
