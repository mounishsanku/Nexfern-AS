import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";

export default function LoginPage() {
  return (
    <Container className="py-10">
      <div className="mx-auto max-w-md rounded-2xl bg-white p-6 shadow-soft ring-1 ring-inset ring-slate-200">
        <div className="text-sm font-semibold text-slate-600">Login</div>
        <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900">
          Welcome back
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Placeholder page. Swap this for your auth provider later.
        </p>
        <div className="mt-6 grid gap-3">
          <Button variant="primary" className="w-full justify-center">
            Continue
          </Button>
          <Button href="/" variant="secondary" className="w-full justify-center">
            Back to home
          </Button>
        </div>
      </div>
    </Container>
  );
}

