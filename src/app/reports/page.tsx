import { Container } from "@/components/ui/Container";
import { TrialBalance } from "./TrialBalance";

export default function ReportsPage() {
  return (
    <Container className="py-10">
      <div className="mb-6">
        <div className="text-sm font-semibold text-slate-600">Reports</div>
        <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">
          Reporting
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
          Click any account row in the trial balance to view its full ledger
          history.
        </p>
      </div>

      <TrialBalance />
    </Container>
  );
}
