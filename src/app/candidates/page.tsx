import Navbar from '@/components/shared/Navbar';
import CandidateRankingsTable from '@/components/candidates/CandidateRankingsTable';
import { getCandidateListView } from '../../../packages/signals/src';

type SortBy = 'rankScore' | 'symbol' | 'currentPrice' | 'triggerPrice' | 'stopDistancePercent' | 'setupStatus';
type Direction = 'asc' | 'desc';

function parseSortBy(value?: string): SortBy {
  switch (value) {
    case 'symbol':
    case 'currentPrice':
    case 'triggerPrice':
    case 'stopDistancePercent':
    case 'setupStatus':
    case 'rankScore':
      return value;
    default:
      return 'rankScore';
  }
}

function parseDirection(value?: string): Direction {
  return value === 'asc' ? 'asc' : 'desc';
}

export default async function CandidatesPage({
  searchParams,
}: {
  searchParams?: Promise<{ sortBy?: string; direction?: string }>;
}) {
  const params = await searchParams;
  const sortBy = parseSortBy(params?.sortBy);
  const direction = parseDirection(params?.direction);
  const view = await getCandidateListView(sortBy, direction);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold text-foreground">Candidates</h1>
          <p className="text-muted-foreground max-w-3xl">
            Sortable next-session candidates with persisted rank scores, entry triggers, initial stops, and the exact reasons and warnings behind each ranking.
          </p>
        </div>

        <CandidateRankingsTable view={view} />
      </main>
    </div>
  );
}