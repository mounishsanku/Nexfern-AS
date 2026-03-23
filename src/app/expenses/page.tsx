import { Container } from "@/components/ui/Container";

export default function ExpensesPage() {
  return (
    <Container className="py-10">
      <div className="rounded-2xl bg-white p-6 shadow-soft ring-1 ring-inset ring-slate-200">
        <div className="text-sm font-semibold text-slate-600">Expenses</div>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900">
          Track spending
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          Add categories, receipts, and month-to-date breakdowns.
        </p>
      </div>
    </Container>
  );
}

