const ExchangeRate = require("../models/ExchangeRate");
const { round2 } = require("../utils/round");

async function getExchangeRate({ fromCurrency, toCurrency, effectiveDate = new Date() }) {
  const from = String(fromCurrency).toUpperCase().trim();
  const to = String(toCurrency).toUpperCase().trim();

  if (from === to) {
    return {
      rate: 1,
      fromCurrency: from,
      toCurrency: to,
      effectiveDate
    };
  }

  // Lookup most recent rate at or before effectiveDate
  const rateDoc = await ExchangeRate.findOne({
    fromCurrency: from,
    toCurrency: to,
    effectiveDate: { $lte: effectiveDate }
  }).sort({ effectiveDate: -1 }).lean();

  if (!rateDoc) {
    const error = new Error(`Exchange rate not found from ${from} to ${to}`);
    error.code = "EXCHANGE_RATE_NOT_FOUND";
    error.fromCurrency = from;
    error.toCurrency = to;
    error.effectiveDate = effectiveDate;
    throw error;
  }

  return {
    rate: rateDoc.rate,
    fromCurrency: rateDoc.fromCurrency,
    toCurrency: rateDoc.toCurrency,
    effectiveDate: rateDoc.effectiveDate
  };
}

async function convertAmount({ amount, fromCurrency, toCurrency, effectiveDate = new Date() }) {
  const numAmount = Number(amount) || 0;
  
  if (String(fromCurrency).toUpperCase() === String(toCurrency).toUpperCase()) {
    return {
      rate: 1,
      convertedAmount: round2(numAmount)
    };
  }

  const { rate } = await getExchangeRate({ fromCurrency, toCurrency, effectiveDate });
  
  return {
    rate,
    convertedAmount: round2(numAmount * rate)
  };
}

module.exports = {
  getExchangeRate,
  convertAmount
};
