import { useState } from 'react';
import { Card, CardHeader } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';

export function HelpCenter() {
  const [searchQuery, setSearchQuery] = useState('');

  const articles = [
    { title: 'First Login & Setup', category: 'Onboarding', content: 'Navigate to settings to configure your first entity and set base currency.' },
    { title: 'Reconciliation Guide', category: 'Operations', content: 'Import your bank statement and review suggested matches.' },
    { title: 'System Diagnostics', category: 'Troubleshooting', content: 'Use the System Operations dashboard to view invariants and cache staleness.' },
    { title: 'Backup & Restore', category: 'Security', content: 'Generate encrypted payloads for safekeeping. Ensure you have the backup key.' },
  ];

  const filteredArticles = articles.filter(a => a.title.toLowerCase().includes(searchQuery.toLowerCase()) || a.category.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Help Center</h1>
        <p className="text-gray-500 dark:text-gray-400">Search documentation, onboarding guides, and troubleshooting articles.</p>
      </div>

      <Input
        placeholder="Search for articles..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        className="max-w-md"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredArticles.map((article, idx) => (
          <Card key={idx}>
            <CardHeader title={article.title} subtitle={article.category} />
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-300">{article.content}</p>
            </div>
          </Card>
        ))}
        {filteredArticles.length === 0 && (
          <div className="col-span-2 text-center py-8 text-gray-500">No articles found matching "{searchQuery}".</div>
        )}
      </div>
    </div>
  );
}
