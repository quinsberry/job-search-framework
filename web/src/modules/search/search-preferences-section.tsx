'use client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { FieldDescription, FieldError } from '@/shared/components/ui/field';
import type { SessionHandle } from '@/shared/drafts/recovery-session';
import type { LoadedWorkspace } from '@/modules/workspace/contracts';
import { preferencesOptions } from './client/queries';
import { PreferencesEditor } from './ui/preferences-editor';

export function SearchPreferencesSection({
	loaded,
	switching,
	onSession,
	onPublished,
}: {
	loaded: LoadedWorkspace | null;
	switching: boolean;
	onSession: (handle: SessionHandle | null) => void;
	onPublished?: (workspace: string) => void;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Search Preferences</CardTitle>
				<CardDescription>
					Configure your target roles, residence, compensation and search limits.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{loaded ? (
					<LoadedPreferences
						{...loaded}
						switching={switching}
						onSession={onSession}
						onPublished={onPublished}
					/>
				) : (
					<FieldDescription>Load a workspace to manage your search preferences.</FieldDescription>
				)}
			</CardContent>
		</Card>
	);
}
function LoadedPreferences(
	props: LoadedWorkspace & {
		switching: boolean;
		onSession: (handle: SessionHandle | null) => void;
		onPublished?: (workspace: string) => void;
	},
) {
	const { data, error } = useQuery(preferencesOptions(props.workspace, props.sessionId));
	return (
		<>
			{error ? <FieldError>{error.message}</FieldError> : null}
			{data ? <PreferencesEditor {...props} snapshot={data} /> : <p role="status">Loading search preferences…</p>}
		</>
	);
}
