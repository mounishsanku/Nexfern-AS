import { Container } from "@/components/ui/Container";

export default function InvoicesPage() {
  return (
    <Container className="py-10">
      <div className="rounded-2xl bg-white p-6 shadow-soft ring-1 ring-inset ring-slate-200">
        <div className="text-sm font-semibold text-slate-600">Invoices</div>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900">
          Manage invoices
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          Add a table here for invoice status, due dates, and totals.
        </p>
      </div>
    </Container>
  );
}

