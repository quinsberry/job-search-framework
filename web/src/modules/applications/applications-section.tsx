'use client';
import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { RequestError } from '@/shared/http/client';
import { Button } from '@/shared/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { FieldDescription, FieldError } from '@/shared/components/ui/field';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { toast } from '@/shared/components/ui/toast';
import type { LoadedWorkspace } from '@/modules/workspace/contracts';
import { ApplicationDialog, type DialogTarget } from './ui//application-table/application-dialog';
import type { RowActionHandlers } from './ui//application-table/applications-columns';
import { ApplicationsTable } from './ui//application-table/applications-table';
import { DeleteDialog } from './ui//application-table/delete-dialog';
import { toRows, type ApplicationRow } from './ui//application-table/rows';
import { useApplicationMutations, useApplications, useSearchRun } from './client/queries';
import type { ManualInput } from './model/contracts';
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

const message = (error: unknown) => (error instanceof Error ? error.message : 'Request failed.');
const gone = (error: unknown) => error instanceof RequestError && error.code === 'not-found';
const goneToast = () => toast.add({ title: 'This application no longer exists', type: 'error' });

function LoadedApplications({ workspace }: { workspace: string }) {
	const { data, error, isPending, refetch, isRefetching } = useApplications(workspace);
	const run = useSearchRun(workspace);
	const { add, update, remove } = useApplicationMutations(workspace);
	const [editing, setEditing] = useState<DialogTarget>(null);
	const [deleting, setDeleting] = useState<ApplicationRow | null>(null);
	const [formError, setFormError] = useState<string | null>(null);
	const rows = useMemo(() => (data ? toRows(data) : []), [data]);

	const { mutate: updateRow, isPending: updating, variables: updated } = update;
	const actions = useMemo<RowActionHandlers>(
		() => ({
			onStatus: (row, status) =>
				updateRow(
					{ fingerprint: row.id, changes: { status } },
					{
						onError: (failure) =>
							gone(failure)
								? goneToast()
								: toast.add({
										title: 'Could not change the status',
										description: message(failure),
										type: 'error',
									}),
					},
				),
			onEdit: (row) => {
				setFormError(null);
				setEditing(row);
			},
			onDelete: setDeleting,
			saving: (row) => updating && updated?.fingerprint === row.id,
		}),
		[updateRow, updating, updated],
	);
	const openAdd = () => {
		setFormError(null);
		setEditing('new');
	};
	const submit = (values: Parameters<typeof updateRow>[0]['changes']) => {
		const onSuccess = (title: string) => () => {
			setEditing(null);
			toast.add({ title, type: 'success' });
		};
		// A row deleted meanwhile closes the dialog; anything else, such as a duplicate, stays in it.
		const onError = (failure: unknown) => {
			if (!gone(failure)) return setFormError(message(failure));
			setEditing(null);
			goneToast();
		};
		if (editing === 'new')
			add.mutate(values as ManualInput, { onSuccess: onSuccess('Application added'), onError });
		else if (editing)
			updateRow({ fingerprint: editing.id, changes: values }, { onSuccess: onSuccess('Changes saved'), onError });
	};
	const confirmDelete = (row: ApplicationRow) =>
		remove.mutate(row.id, {
			onSuccess: () => toast.add({ title: 'Application deleted', type: 'success' }),
			onError: (failure) =>
				gone(failure)
					? goneToast()
					: toast.add({ title: 'Could not delete', description: message(failure), type: 'error' }),
			onSettled: () => setDeleting(null),
		});

	const header = (
		<div className="flex gap-2">
			<Button variant="outline" onClick={openAdd}>
				<Plus />
				Add application
			</Button>
			<SearchRunButton status={run.status} start={() => void run.start()} cancel={run.cancel} />
		</div>
	);
	return (
		<Card>
			<Header action={header} />
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
					<ApplicationsTable rows={rows} actions={actions} />
				) : (
					<FieldDescription>
						No applications yet. Run a search to find vacancies that match your preferences, or add one
						yourself.
					</FieldDescription>
				)}
			</CardContent>
			<ApplicationDialog
				target={editing}
				busy={add.isPending || (updating && editing !== 'new' && updated?.fingerprint === editing?.id)}
				error={formError}
				onClose={() => setEditing(null)}
				onSubmit={submit}
			/>
			<DeleteDialog
				row={deleting}
				busy={remove.isPending}
				onClose={() => setDeleting(null)}
				onConfirm={confirmDelete}
			/>
		</Card>
	);
}
