
import { Container } from "@/components/ui/Container";
import { Card } from "@/components/ui/Card";
import { useLocalization } from "@/context/LocalizationContext";
import { PageSkeleton } from "@/components/ui/Skeleton";

export function LocalizationSettings() {
  const { activeEntity, metadata, isLoading, invoiceFields } = useLocalization();

  if (isLoading) return <PageSkeleton />;

  return (
    <Container className="py-6">
      <h1 className="text-2xl font-bold mb-6">Localization Settings</h1>

      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">Active Entity</h2>
        <div className="grid grid-cols-2 gap-4 text-sm mb-8">
          <div>
            <span className="text-gray-500">Name:</span>{" "}
            <span className="font-medium">{activeEntity?.name}</span>
          </div>
          <div>
            <span className="text-gray-500">Country:</span>{" "}
            <span className="font-medium">{activeEntity?.country}</span>
          </div>
          <div>
            <span className="text-gray-500">Base Currency:</span>{" "}
            <span className="font-medium">{activeEntity?.baseCurrency}</span>
          </div>
        </div>

        <h2 className="text-xl font-semibold mb-4">Localization Pack Metadata</h2>
        {metadata ? (
          <div className="grid grid-cols-2 gap-4 text-sm mb-8">
            <div>
              <span className="text-gray-500">Pack Country:</span>{" "}
              <span className="font-medium">{metadata.country} ({metadata.name})</span>
            </div>
            <div>
              <span className="text-gray-500">Localization Currency:</span>{" "}
              <span className="font-medium">{metadata.currency}</span>
            </div>
            {metadata.dateFormat && (
              <div>
                <span className="text-gray-500">Date Format:</span>{" "}
                <span className="font-medium">{metadata.dateFormat}</span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-500 mb-8">No localization pack found for this entity's country.</p>
        )}

        <h2 className="text-xl font-semibold mb-4">Dynamic Invoice Form Fields</h2>
        {invoiceFields && invoiceFields.length > 0 ? (
          <ul className="list-disc list-inside text-sm text-gray-700">
            {invoiceFields.map((field) => (
              <li key={field}>{field}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-500">No dynamic fields rendered by the active pack.</p>
        )}
      </Card>
    </Container>
  );
}
