import React, { useEffect, useState } from "react";
import { Container } from "@/components/ui/Container";
import { Card } from "@/components/ui/Card";
import { Table } from "@/components/ui/Table";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { fetchCurrencies, createCurrency, fetchExchangeRates, createExchangeRate } from "@/adminApi";
import { Input } from "@/components/ui/Input";

export function CurrencyManagement() {
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [rates, setRates] = useState<any[]>([]);
  const [isCurrencyModalOpen, setIsCurrencyModalOpen] = useState(false);
  const [isRateModalOpen, setIsRateModalOpen] = useState(false);
  
  const [currencyForm, setCurrencyForm] = useState({ code: "", name: "", symbol: "", decimals: 2 });
  const [rateForm, setRateForm] = useState({ fromCurrency: "", toCurrency: "", rate: 1, effectiveDate: new Date().toISOString().split('T')[0] });
  
  const [isSubmitting, setIsSubmitting] = useState(false);

  const loadData = async () => {
    try {
      const [currData, rateData] = await Promise.all([fetchCurrencies(), fetchExchangeRates()]);
      setCurrencies(currData as any[]);
      setRates(rateData as any[]);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCurrencySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await createCurrency(currencyForm);
      setIsCurrencyModalOpen(false);
      loadData();
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await createExchangeRate({
        ...rateForm,
        rate: Number(rateForm.rate),
        effectiveDate: new Date(rateForm.effectiveDate)
      });
      setIsRateModalOpen(false);
      loadData();
    } catch (e) {
      console.error(e);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Container className="py-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Currency Management</h1>
        <div className="space-x-2">
          <Button variant="secondary" onClick={() => setIsCurrencyModalOpen(true)}>Add Currency</Button>
          <Button variant="primary" onClick={() => setIsRateModalOpen(true)}>Add Exchange Rate</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="p-4">
          <h2 className="text-xl font-semibold mb-4">Supported Currencies</h2>
          <Table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Symbol</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {currencies.map((c) => (
                <tr key={c._id}>
                  <td className="font-medium">{c.code}</td>
                  <td>{c.name}</td>
                  <td>{c.symbol}</td>
                  <td>
                    <Badge variant={c.isActive ? "success" : "neutral"}>
                      {c.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card className="p-4">
          <h2 className="text-xl font-semibold mb-4">Historical Exchange Rates</h2>
          <Table>
            <thead>
              <tr>
                <th>Pair</th>
                <th>Rate</th>
                <th>Effective Date</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r._id}>
                  <td className="font-medium">{r.fromCurrency} → {r.toCurrency}</td>
                  <td>{r.rate}</td>
                  <td>{new Date(r.effectiveDate).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>

      <Modal open={isCurrencyModalOpen} onClose={() => setIsCurrencyModalOpen(false)} title="Add Currency">
        <form onSubmit={handleCurrencySubmit} className="space-y-4">
          <div className="grid gap-1">
            <span className="text-sm font-semibold text-slate-700">Currency Code (e.g. USD) <span className="text-red-500">*</span></span>
            <Input required value={currencyForm.code} onChange={(e) => setCurrencyForm({ ...currencyForm, code: e.target.value.toUpperCase() })} />
          </div>
          <div className="grid gap-1">
            <span className="text-sm font-semibold text-slate-700">Name (e.g. US Dollar) <span className="text-red-500">*</span></span>
            <Input required value={currencyForm.name} onChange={(e) => setCurrencyForm({ ...currencyForm, name: e.target.value })} />
          </div>
          <div className="grid gap-1">
            <span className="text-sm font-semibold text-slate-700">Symbol (e.g. $) <span className="text-red-500">*</span></span>
            <Input required value={currencyForm.symbol} onChange={(e) => setCurrencyForm({ ...currencyForm, symbol: e.target.value })} />
          </div>
          <div className="flex justify-end space-x-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsCurrencyModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Save Currency"}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={isRateModalOpen} onClose={() => setIsRateModalOpen(false)} title="Add Exchange Rate">
        <form onSubmit={handleRateSubmit} className="space-y-4">
          <div className="grid gap-1">
            <span className="text-sm font-semibold text-slate-700">From Currency (e.g. USD) <span className="text-red-500">*</span></span>
            <Input required value={rateForm.fromCurrency} onChange={(e) => setRateForm({ ...rateForm, fromCurrency: e.target.value.toUpperCase() })} />
          </div>
          <div className="grid gap-1">
            <span className="text-sm font-semibold text-slate-700">To Currency (e.g. INR) <span className="text-red-500">*</span></span>
            <Input required value={rateForm.toCurrency} onChange={(e) => setRateForm({ ...rateForm, toCurrency: e.target.value.toUpperCase() })} />
          </div>
          <div className="grid gap-1">
            <span className="text-sm font-semibold text-slate-700">Exchange Rate <span className="text-red-500">*</span></span>
            <Input type="number" step="0.000001" required value={rateForm.rate} onChange={(e) => setRateForm({ ...rateForm, rate: parseFloat(e.target.value) })} />
          </div>
          <div className="grid gap-1">
            <span className="text-sm font-semibold text-slate-700">Effective Date <span className="text-red-500">*</span></span>
            <Input type="date" required value={rateForm.effectiveDate} onChange={(e) => setRateForm({ ...rateForm, effectiveDate: e.target.value })} />
          </div>
          <div className="flex justify-end space-x-2 pt-4">
            <Button variant="secondary" type="button" onClick={() => setIsRateModalOpen(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={isSubmitting}>{isSubmitting ? "Saving..." : "Save Rate"}</Button>
          </div>
        </form>
      </Modal>
    </Container>
  );
}
