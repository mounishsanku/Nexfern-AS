/**
 * Standard production error shapes for consistent API responses.
 */

function insufficientFunds() {
  const err = new Error("Insufficient funds");
  err.code = "INSUFFICIENT_FUNDS";
  err.status = 400;
  return err;
}

function fyLocked() {
  const err = new Error("Financial year is closed");
  err.code = "FY_LOCKED";
  err.status = 403;
  return err;
}

function recordImmutable(message = "This posted record cannot be modified or deleted") {
  const err = new Error(message);
  err.code = "RECORD_IMMUTABLE";
  err.status = 403;
  return err;
}

module.exports = { insufficientFunds, fyLocked, recordImmutable };
