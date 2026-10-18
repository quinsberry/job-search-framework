'use client';
import { useCallback, useState } from 'react';
import { Button } from '@/shared/components/ui/button';
import { Badge } from '@/shared/components/ui/badge';
import { FieldGroup, FieldDescription, FieldError } from '@/shared/components/ui/field';
import { UploadFileButton } from '@/shared/components/upload-file-button';
import { processing, type ProfileSnapshot } from '../model/contracts';
import { fromFormValues } from '../model/form-model';
import { hasProfileChanges } from '../model/editor-state';
import { useProfileSession, type ProfileHandle } from '../client/use-profile-session';
import type { ProviderReadiness } from '@/shared/ai/contracts';
import { ProfileConfirmation, type Confirmation } from './profile-confirmation';
import { ProfileProgress, RecoveryStatus } from './profile-progress';
import { ProfileForm, useProfileForm } from './profile-form';

export function ProfileEditor({
	workspace,
	sessionId,
	initial,
	snapshot,
	provider,
	connection,
	switching,
	onSession,
}: {
	workspace: string;
	sessionId: string;
	initial: ProfileSnapshot;
	snapshot: ProfileSnapshot;
	provider: string;
	connection: ProviderReadiness;
	switching: boolean;
	onSession: (handle: ProfileHandle | null) => void;
}) {
	const form = useProfileForm(initial);
	const [open, setOpen] = useState(false);
	const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
	const converted = useCallback(() => setOpen(false), []);
	const { session, act, busy, error } = useProfileSession({
		workspace,
		sessionId,
		initial,
		snapshot,
		form,
		provider,
		onSession,
		onConverted: converted,
	});
	const active = processing(snapshot.job);
	const hasEditor = !!(snapshot.profile || snapshot.draft);
	const disabled = busy || active || switching;
	function upload(file: File) {
		const changed = hasProfileChanges(fromFormValues(form.getValues()).values, session.getState().baseline);
		if (changed || (!snapshot.profile && snapshot.draft)) setConfirmation({ action: 'upload', file });
		else act({ kind: 'start', file });
	}
	return (
		<FieldGroup>
			<div className="flex flex-wrap items-center gap-3">
				<UploadFileButton
					label="Upload CV"
					accept=".pdf,.md,.markdown"
					disabled={!connection.available || disabled}
					onFileSelect={upload}
				/>
				<Badge variant={snapshot.profile ? 'default' : 'secondary'}>
					{snapshot.profile ? 'Saved profile available' : 'No saved profile'}
				</Badge>
				{snapshot.draft ? <Badge variant="outline">Recovery draft</Badge> : null}
			</div>
			<FieldDescription>
				{connection.available
					? 'PDF or Markdown, up to 10 MiB. Your saved profile changes only after Save.'
					: connection.message + ' Saved profiles can still be edited without AI.'}
			</FieldDescription>
			<ProfileProgress job={snapshot.job} busy={busy} />
			<RecoveryStatus
				session={session}
				showMessage={hasEditor && !active}
				reload={() => setConfirmation({ action: 'reload' })}
			/>
			<FieldError>{error || snapshot.job?.error}</FieldError>
			{snapshot.job?.phase === 'failed' || snapshot.job?.phase === 'interrupted' ? (
				<Button disabled={!connection.available || disabled} onClick={() => act({ kind: 'retry' })}>
					Retry conversion
				</Button>
			) : null}
			{hasEditor ? (
				<ProfileForm
					form={form}
					session={session}
					open={open}
					onOpenChange={setOpen}
					disabled={disabled}
					unpublished={!snapshot.profile && !!snapshot.draft}
					busy={busy}
					onSave={() => act({ kind: 'publish' })}
					onDiscard={() => setConfirmation({ action: 'discard' })}
				/>
			) : null}
			<ProfileConfirmation
				choice={confirmation}
				close={() => setConfirmation(null)}
				confirm={(choice) => {
					if (choice.action === 'upload') act({ kind: 'start', file: choice.file });
					else act({ kind: choice.action });
				}}
			/>
		</FieldGroup>
	);
}
