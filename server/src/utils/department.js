const DEPARTMENTS = ["academy", "tech", "marketing"];

function normalizeDepartment(value) {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return DEPARTMENTS.includes(v) ? v : null;
}

function defaultDepartmentFromRevenueType(revenueType) {
  const t = typeof revenueType === "string" ? revenueType.trim().toLowerCase() : "";
  if (t === "academy") return "academy";
  if (t === "event") return "marketing";
  return "tech";
}

module.exports = {
  DEPARTMENTS,
  normalizeDepartment,
  defaultDepartmentFromRevenueType,
};
