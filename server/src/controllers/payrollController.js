const mongoose = require("mongoose");
const Employee = require("../models/Employee");
const Payslip = require("../models/Payslip");
const VoucherEntry = require("../models/VoucherEntry");
const Account = require("../models/Account");
const { createVoucher } = require("../services/voucherService");
const { recordBankTransaction } = require("../services/bankService");
const { logAction, ACTIONS, buildMetadata } = require("../utils/audit");
const { normalizeDepartment } = require("../utils/department");
const { round2 } = require("../utils/round");
const { assertPostTransactionAccountingInvariants } = require("../services/accountingInvariantsService");
const { sendInternalError, ACTION } = require("../utils/httpErrorResponse");

function toNum(v) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function getMonthKey(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

// POST /api/payroll/employees
async function createEmployee(req, res) {
  try {
    const {
      name,
      email,
      role,
      joiningDate,
      isActive = true,
      basicSalary,
      allowances = 0,
      deductions = 0,
      tds = 0,
      pfAmount = 0,
      esiAmount = 0,
    } = req.body ?? {};

    if (!name || !email) {
      return res.status(400).json({ message: "name and email are required" });
    }
    const basic = toNum(basicSalary);
    const alw = toNum(allowances);
    const ded = toNum(deductions);
    const tdsNum = toNum(tds);
    const pfNum = toNum(pfAmount);
    const esiNum = toNum(esiAmount);
    if (basic === null || basic < 0) return res.status(400).json({ message: "basicSalary must be >= 0" });
    if (alw === null || alw < 0) return res.status(400).json({ message: "allowances must be >= 0" });
    if (ded === null || ded < 0) return res.status(400).json({ message: "deductions must be >= 0" });
    if (tdsNum === null || tdsNum < 0) return res.status(400).json({ message: "tds must be >= 0" });
    if (pfNum === null || pfNum < 0) return res.status(400).json({ message: "pfAmount must be >= 0" });
    if (esiNum === null || esiNum < 0) return res.status(400).json({ message: "esiAmount must be >= 0" });

    const gross = basic + alw;
    const salary = Math.max(0, gross - ded - tdsNum - pfNum - esiNum);

    const employee = await Employee.create({
      name: String(name).trim(),
      email: String(email).trim().toLowerCase(),
      role: role ? String(role).trim() : "employee",
      joiningDate: joiningDate ? new Date(joiningDate) : new Date(),
      isActive: Boolean(isActive),
      salary,
      basicSalary: basic,
      allowances: alw,
      deductions: ded,
      tds: tdsNum,
      pfAmount: pfNum,
      esiAmount: esiNum,
    });

    return res.status(201).json(employee);
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ message: "employee email already exists" });
    }
    console.error("createEmployee error:", err);
    return sendInternalError(res, err, { code: "PAYROLL_FAILED", action: ACTION.RETRY });
  }
}

// GET /api/payroll/employees
async function getEmployees(_req, res) {
  try {
    const rows = await Employee.find().sort({ createdAt: -1 }).lean();
    return res.json(rows);
  } catch (err) {
    console.error("getEmployees error:", err);
    return sendInternalError(res, err, { code: "PAYROLL_FAILED", action: ACTION.RETRY });
  }
}

// POST /api/payroll/run
// Atomic: on any failure, no voucher or payslip is created.
async function runPayroll(req, res) {
  try {
    const userId = req.user?.sub ?? req.user?.id;
    const { month, paymentAccount = "cash", department, bankAccountId = null } = req.body ?? {};
    const monthKey = typeof month === "string" && /^\d{4}-\d{2}$/.test(month) ? month : getMonthKey();
    const payViaBank = String(paymentAccount).toLowerCase() === "bank";
    const accountName = payViaBank ? "Bank" : "Cash";
    const payrollDepartment = normalizeDepartment(department) || "tech";

    if (payViaBank && (!bankAccountId || !mongoose.Types.ObjectId.isValid(String(bankAccountId)))) {
      return res.status(400).json({
        message: "bankAccountId is required when paymentAccount is bank",
        code: "PAYROLL_BANK_ACCOUNT_REQUIRED",
      });
    }

    const financialYearId = req.activeYear?._id ?? null;
    if (!financialYearId) {
      return res.status(400).json({ message: "Active financial year is required", code: "ACTIVE_FY_REQUIRED" });
    }

    const employees = await Employee.find({ isActive: true }).lean();
    if (employees.length === 0) {
      return res.status(400).json({
        message: "No active employees found. Add employees before running payroll.",
        code: "NO_ACTIVE_EMPLOYEES",
      });
    }

    const toProcess = [];
    const skipped = [];

    for (const emp of employees) {
      const already = await Payslip.findOne({ employeeId: emp._id, month: monthKey }).lean();
      if (already) {
        skipped.push({ employeeId: emp._id, employeeName: emp.name, reason: "Payslip already exists for month" });
        continue;
      }

      const basic = Number(emp.basicSalary);
      if (!Number.isFinite(basic) || basic <= 0) {
        skipped.push({ employeeId: emp._id, employeeName: emp.name, reason: "Invalid basicSalary (must be > 0)" });
        continue;
      }
      const allowances = Number(emp.allowances) || 0;
      const baseDeductions = Number(emp.deductions) || 0;
      const salaryTds = Number(emp.tds) || 0;
      const pfAmount = Number(emp.pfAmount) || 0;
      const esiAmount = Number(emp.esiAmount) || 0;
      const nonTdsDeductions = round2(baseDeductions + pfAmount + esiAmount);
      const totalDeductions = round2(nonTdsDeductions + salaryTds);
      const gross = round2(basic + allowances);
      if (gross <= 0) {
        skipped.push({ employeeId: emp._id, employeeName: emp.name, reason: "Invalid gross salary (must be > 0)" });
        continue;
      }
      const net = round2(Math.max(0, gross - totalDeductions));
      if (net <= 0) {
        skipped.push({ employeeId: emp._id, employeeName: emp.name, reason: "Net salary is 0; voucher not created" });
        continue;
      }

      const entries = [{ account: "Salary Expense", debit: gross, credit: 0 }];
      entries.push({ account: accountName, debit: 0, credit: net });
      if (salaryTds > 0) entries.push({ account: "TDS Payable", debit: 0, credit: salaryTds });
      if (nonTdsDeductions > 0) {
        entries.push({ account: "Payroll Deductions Payable", debit: 0, credit: nonTdsDeductions });
      }

      toProcess.push({
        emp,
        gross,
        totalDeductions,
        salaryTds,
        pfAmount,
        esiAmount,
        net,
        entries,
      });
    }

    if (toProcess.length === 0) {
      if (skipped.length > 0) {
        const err = new Error("Payroll already processed for this month");
        err.code = "ALREADY_PROCESSED";
        throw err;
      }
      return res.status(201).json({
        month: monthKey,
        processedCount: 0,
        skippedCount: 0,
        processed: [],
        skipped: [],
        errors: [],
        payslips: [],
      });
    }

    const session = await mongoose.startSession();
    const processed = [];
    const payslips = [];

    try {
      await session.withTransaction(async () => {
        for (const item of toProcess) {
          const { emp, gross, totalDeductions, salaryTds, pfAmount, esiAmount, net, entries } = item;

          const slipArr = await Payslip.create(
            [
              {
                employeeId: emp._id,
                month: monthKey,
                gross,
                deductions: totalDeductions,
                tds: salaryTds,
                pfAmount,
                esiAmount,
                net,
                generatedAt: new Date(),
                financialYearId,
                voucherId: null,
              },
            ],
            { session }
          );
          const slip = slipArr[0];

          const { voucher } = await createVoucher({
            type: "payroll",
            narration: `Salary payment — ${emp.name} ${monthKey}`,
            financialYearId,
            referenceType: "payroll",
            referenceId: slip._id,
            department: payrollDepartment,
            entries,
            session,
          });

          await Payslip.updateOne({ _id: slip._id }, { $set: { voucherId: voucher._id } }, { session });

          payslips.push(slip);
          processed.push({ employeeId: emp._id, employeeName: emp.name, payslipId: slip._id });

          await recordBankTransaction({
            bankAccountId: payViaBank ? bankAccountId : null,
            type: "debit",
            amount: net,
            referenceType: "payroll",
            referenceId: slip._id,
            session,
          });
        }
        await assertPostTransactionAccountingInvariants(financialYearId, session);
      });
    } catch (txErr) {
      console.error("runPayroll transaction error:", txErr);
      const inv =
        txErr?.code === "ACCOUNTING_INVARIANT_BANK_GL" ||
        txErr?.code === "ACCOUNTING_INVARIANT_BALANCE_SHEET" ||
        txErr?.code === "ACCOUNTING_INVARIANT_NEGATIVE_BANK" ||
        txErr?.code === "INSUFFICIENT_FUNDS";
      return res.status(inv ? txErr.status || 503 : 500).json({
        message: txErr instanceof Error ? txErr.message : "Payroll run failed",
        code: inv ? txErr.code : "PAYROLL_RUN_FAILED",
        metrics: txErr?.metrics,
        processedCount: 0,
        skippedCount: skipped.length,
        processed: [],
        skipped,
        errors: [{ message: "No voucher or payslip created due to failure.", code: "PAYROLL_ATOMIC_FAILED" }],
      });
    } finally {
      await session.endSession();
    }

    for (const slip of payslips) {
      await logAction(userId, ACTIONS.CREATE, "payslip", slip._id, buildMetadata(null, {
        employeeId: slip.employeeId.toString(),
        month: monthKey,
        gross: slip.gross,
        deductions: slip.deductions,
        tds: slip.tds,
        pfAmount: slip.pfAmount,
        esiAmount: slip.esiAmount,
        net: slip.net,
        department: payrollDepartment,
      }));
    }

    return res.status(201).json({
      month: monthKey,
      processedCount: processed.length,
      skippedCount: skipped.length,
      processed,
      skipped,
      errors: [],
      payslips,
    });
  } catch (err) {
    if (
      err?.code === "BANK_GL_BLOCK" ||
      err?.code === "ACCOUNTING_INVARIANT_BANK_GL" ||
      err?.code === "ACCOUNTING_INVARIANT_BALANCE_SHEET"
    ) {
      return res.status(err.status || 503).json({
        message: err.message,
        code: err.code,
        metrics: err.metrics,
      });
    }
    if (err?.code === "ALREADY_PROCESSED") {
      return res.status(409).json({ message: err.message, code: "ALREADY_PROCESSED" });
    }
    console.error("runPayroll error:", err);
    return sendInternalError(res, err, { code: "PAYROLL_FAILED", action: ACTION.RETRY });
  }
}

// GET /api/payroll
async function getPayroll(req, res) {
  try {
    const { month } = req.query ?? {};
    const filter = {};
    if (typeof month === "string" && /^\d{4}-\d{2}$/.test(month)) filter.month = month;

    const rows = await Payslip.find(filter)
      .populate("employeeId", "name email role")
      .sort({ month: -1, generatedAt: -1 })
      .lean();
    return res.json(rows);
  } catch (err) {
    console.error("getPayroll error:", err);
    return sendInternalError(res, err, { code: "PAYROLL_FAILED", action: ACTION.RETRY });
  }
}

// GET /api/payroll/summary
// Totals derived from voucher data to ensure UI/backend consistency.
async function getPayrollSummary(req, res) {
  try {
    const { month } = req.query ?? {};
    const filter = {};
    if (typeof month === "string" && /^\d{4}-\d{2}$/.test(month)) filter.month = month;

    const [payslips, activeEmployeeCount] = await Promise.all([
      Payslip.find(filter).select("month gross deductions tds pfAmount esiAmount net voucherId").lean(),
      Employee.countDocuments({ isActive: true }),
    ]);
    const payslipCount = payslips.length;

    let gross = 0, deductions = 0, tds = 0, pfAmount = 0, esiAmount = 0, net = 0;

    if (payslipCount > 0) {
      const voucherIds = payslips.filter((p) => p.voucherId).map((p) => p.voucherId);
      const entries = await VoucherEntry.find({ voucherId: { $in: voucherIds } })
        .populate("accountId", "name")
        .lean();

      const salaryAcct = await Account.findOne({ name: "Salary Expense" }).select("_id").lean();
      const tdsAcct = await Account.findOne({ name: "TDS Payable" }).select("_id").lean();
      const deductAcct = await Account.findOne({ name: "Payroll Deductions Payable" }).select("_id").lean();
      const cashAcct = await Account.findOne({ name: "Cash" }).select("_id").lean();
      const bankAcct = await Account.findOne({ name: "Bank" }).select("_id").lean();

      let nonTdsDeductions = 0;
      for (const e of entries) {
        const aid = String(e.accountId?._id || "");
        if (salaryAcct && aid === String(salaryAcct._id)) gross += Number(e.debit) || 0;
        else if (tdsAcct && aid === String(tdsAcct._id)) tds += Number(e.credit) || 0;
        else if (deductAcct && aid === String(deductAcct._id)) nonTdsDeductions += Number(e.credit) || 0;
        else if ((cashAcct && aid === String(cashAcct._id)) || (bankAcct && aid === String(bankAcct._id))) {
          net += Number(e.credit) || 0;
        }
      }
      deductions = round2(tds + nonTdsDeductions);
      gross = round2(gross);
      tds = round2(tds);
      net = round2(net);

      for (const r of payslips) {
        pfAmount += Number(r.pfAmount) || 0;
        esiAmount += Number(r.esiAmount) || 0;
      }
      pfAmount = round2(pfAmount);
      esiAmount = round2(esiAmount);
    }

    return res.json({
      month: typeof month === "string" ? month : null,
      totalEmployees: payslipCount,
      payslipCount,
      activeEmployeeCount,
      totals: {
        gross,
        deductions,
        tds,
        pfAmount,
        esiAmount,
        net,
      },
    });
  } catch (err) {
    console.error("getPayrollSummary error:", err);
    return sendInternalError(res, err, { code: "PAYROLL_FAILED", action: ACTION.RETRY });
  }
}

module.exports = { createEmployee, getEmployees, runPayroll, getPayroll, getPayrollSummary };
