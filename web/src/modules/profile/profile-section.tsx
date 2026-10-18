'use client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { FieldDescription, FieldError } from '@/shared/components/ui/field';
import { UploadFileButton } from '@/shared/components/upload-file-button';
import type { Provider, ProviderReadiness } from '@/shared/ai/contracts';
import type { LoadedWorkspace } from '@/modules/workspace/contracts';
import { profileOptions } from './client/queries';
import { ProfileEditor } from './ui/profile-editor';
import type { ProfileHandle } from './client/use-profile-session';
export type { ProfileHandle } from './client/use-profile-session';

type AgentProps = { provider: Provider; connection: ProviderReadiness };

export function ProfileSection({
	loaded,
	switching,
	onSession,
	provider,
	connection,
}: {
	loaded: LoadedWorkspace | null;
	switching: boolean;
	onSession: (handle: ProfileHandle | null) => void;
} & AgentProps) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Candidate Profile</CardTitle>
				<CardDescription>Upload a CV, review its fields and save your candidate profile.</CardDescription>
			</CardHeader>
			<CardContent>
				{loaded ? (
					<LoadedProfile
						{...loaded}
						switching={switching}
						onSession={onSession}
						provider={provider}
						connection={connection}
					/>
				) : (
					<>
						<UploadFileButton
							label="Upload CV"
							accept=".pdf,.md,.markdown"
							disabled
							onFileSelect={() => {}}
						/>
						<FieldDescription>Load a workspace to manage your candidate profile.</FieldDescription>
					</>
				)}
			</CardContent>
		</Card>
	);
}
function LoadedProfile({
	workspace,
	sessionId,
	switching,
	onSession,
	provider,
	connection,
}: LoadedWorkspace & { switching: boolean; onSession: (handle: ProfileHandle | null) => void } & AgentProps) {
	const { data, error } = useQuery(profileOptions(workspace, sessionId));
	return (
		<>
			{error ? <FieldError>{error.message}</FieldError> : null}
			{data ? (
				<ProfileEditor
					workspace={workspace}
					sessionId={sessionId}
					initial={data}
					snapshot={data}
					provider={provider}
					connection={connection}
					switching={switching}
					onSession={onSession}
				/>
			) : (
				<p role="status">Loading candidate profile…</p>
			)}
		</>
	);
}
