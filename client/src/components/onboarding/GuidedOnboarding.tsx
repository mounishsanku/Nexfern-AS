import { useState } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export function GuidedOnboarding() {
  const [step, setStep] = useState(0);

  const steps = [
    { title: 'Welcome to Nexfern FinanceOS', content: 'Let\'s get your enterprise set up. We\'ll guide you through the essential configurations.' },
    { title: 'Step 1: Setup Entity', content: 'Navigate to Settings -> Entity Settings. Provide your Legal Name, Registration Number, and select your Base Currency. This forms the foundation of your accounting.' },
    { title: 'Step 2: Create Your First Invoice', content: 'Go to Invoices -> Create. Select a customer and add your line items. When you save, the system will automatically generate the corresponding Voucher Entries in the background.' },
    { title: 'Step 3: Reconcile Bank Feeds', content: 'Go to Reconcile. Import your bank statement. The system will suggest matches against your invoices and expenses. Confirm to lock them in.' },
    { title: 'Step 4: View Analytics', content: 'Check the Dashboard and Analytics pages. All KPIs and reports are generated in real-time directly from your reconciled Voucher Entries, guaranteeing accuracy.' },
    { title: 'You\'re Ready!', content: 'Your core setup is complete. For further configurations like Localization or Tax Profiles, visit the Settings page.' }
  ];

  const handleNext = () => setStep(s => Math.min(steps.length - 1, s + 1));
  const handlePrev = () => setStep(s => Math.max(0, s - 1));

  return (
    <Card className="max-w-xl mx-auto my-8 border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10 shadow-lg">
      <CardHeader title={steps[step].title} subtitle={`Onboarding Guide (${step + 1}/${steps.length})`} />
      <div className="mb-4">
        <p className="text-gray-700 dark:text-gray-300 min-h-[60px]">{steps[step].content}</p>
      </div>
      <div className="flex justify-between border-t border-blue-100 dark:border-blue-800/50 pt-4 mt-2">
        <Button variant="secondary" onClick={handlePrev} disabled={step === 0}>Previous</Button>
        <Button variant="primary" onClick={handleNext} disabled={step === steps.length - 1}>
          {step === steps.length - 2 ? 'Finish' : 'Next'}
        </Button>
      </div>
    </Card>
  );
}
