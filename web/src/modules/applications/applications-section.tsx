'use client';
import { useMemo } from 'react';
import { Button } from '@/shared/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { FieldDescription, FieldError } from '@/shared/components/ui/field';
import { Skeleton } from '@/shared/components/ui/skeleton';
import type { LoadedWorkspace } from '@/modules/workspace/contracts';
import { ApplicationsTable } from './application-table/applications-table';
import { toRows } from './application-table/rows';
import { useApplications, useSearchRun } from './client/queries';
import { SearchRunButton, SearchRunStatus } from './ui/search-run';

export function ApplicationsSection({ loaded }: { loaded: LoadedWorkspace | null }) {
	return loaded ? (
		<LoadedApplications workspace={loaded.workspace} />
	) : (
		<Card>
			<Header />
			<CardContent>
				<FieldDescription>Open a workspace to see applications.</FieldDescription>
			</CardContent>
		</Card>
	);
}

function Header({ action }: { action?: React.ReactNode }) {
	return (
		<CardHeader>
			<CardTitle>Applications</CardTitle>
			<CardDescription>Vacancies that match your search preferences, or need a closer look.</CardDescription>
			{action ? <CardAction>{action}</CardAction> : null}
		</CardHeader>
	);
}

function LoadedApplications({ workspace }: { workspace: string }) {
	const { data, error, isPending, refetch, isRefetching } = useApplications(workspace);
	const run = useSearchRun(workspace);
	const rows = useMemo(() => (data ? toRows(data) : []), [data]);
	const button = <SearchRunButton status={run.status} start={() => void run.start()} cancel={run.cancel} />;
	return (
		<Card>
			<Header action={button} />
			<CardContent className="space-y-2">
				<SearchRunStatus {...run} />
				{isPending ? (
					<div className="space-y-2" aria-label="Loading applications">
						{Array.from({ length: 5 }, (_, index) => (
							<Skeleton key={index} className="h-9 w-full" />
						))}
					</div>
				) : error ? (
					<div className="flex items-center gap-3">
						<FieldError>{error.message}</FieldError>
						<Button variant="outline" size="sm" isInProgress={isRefetching} onClick={() => void refetch()}>
							Retry
						</Button>
					</div>
				) : rows.length ? (
					<ApplicationsTable rows={rows} />
				) : (
					<FieldDescription>
						No applications yet. Run a search to find vacancies that match your preferences.
					</FieldDescription>
				)}
			</CardContent>
		</Card>
	);
}
