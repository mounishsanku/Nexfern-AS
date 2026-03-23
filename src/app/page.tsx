import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";

export default function Home() {
  return (
    <div className="py-10 sm:py-14">
      <Container>
        <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
          <section className="lg:col-span-7">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              SaaS starter UI
            </div>
            <h1 className="mt-4 text-balance text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
              Clean finance ops for modern teams.
            </h1>
            <p className="mt-4 max-w-2xl text-pretty text-lg leading-7 text-slate-600">
              Nexfern is a lightweight, elegant base UI for dashboards, invoices,
              expenses, and reports—built with Next.js App Router, TypeScript,
              and Tailwind.
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button href="/dashboard" variant="primary" className="shadow-soft-lg">
                Go to Dashboard
              </Button>
              <Button href="/invoices" variant="secondary">
                View Invoices
              </Button>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {[
                {
                  title: "Rounded & soft",
                  description:
                    "XL / 2XL corners with gentle elevation for a calm feel.",
                },
                {
                  title: "Green primary",
                  description:
                    "A crisp #22c55e accent that works across light surfaces.",
                },
                {
                  title: "Inter typography",
                  description:
                    "Crisp, modern text hierarchy that’s easy to extend.",
                },
                {
                  title: "App Router ready",
                  description:
                    "Routes are laid out for a typical SaaS navigation.",
                },
              ].map((f) => (
                <div
                  key={f.title}
                  className="rounded-2xl bg-white p-5 shadow-soft ring-1 ring-inset ring-slate-200"
                >
                  <div className="text-sm font-bold text-slate-900">{f.title}</div>
                  <div className="mt-1 text-sm leading-6 text-slate-600">
                    {f.description}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <aside className="lg:col-span-5">
            <div className="overflow-hidden rounded-2xl bg-white shadow-soft ring-1 ring-inset ring-slate-200">
              <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
                <div className="text-sm font-bold text-slate-900">
                  Quick preview
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  A simple card style you can reuse across pages.
                </div>
              </div>
              <div className="p-5">
                <div className="grid gap-3">
                  {[
                    { label: "Revenue", value: "$84,120", delta: "+12.4%" },
                    { label: "Invoices", value: "128", delta: "+6.1%" },
                    { label: "Expenses", value: "$19,440", delta: "-2.0%" },
                  ].map((row) => (
                    <div
                      key={row.label}
                      className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3"
                    >
                      <div className="text-sm font-semibold text-slate-700">
                        {row.label}
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-extrabold text-slate-900">
                          {row.value}
                        </div>
                        <div className="text-xs font-semibold text-primary">
                          {row.delta}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-5 rounded-2xl bg-primary/10 p-4">
                  <div className="text-sm font-bold text-slate-900">
                    Tip: keep it consistent
                  </div>
                  <div className="mt-1 text-sm leading-6 text-slate-600">
                    Use white surfaces on a light gray background, with soft
                    shadows and subtle borders.
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </Container>
    </div>
  );
}
