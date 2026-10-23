'use client';
import { useState, useSyncExternalStore } from 'react';
import { useForm, useWatch, type Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/shared/components/ui/button';
import { Badge } from '@/shared/components/ui/badge';
import { FieldDescription, FieldError, FieldGroup } from '@/shared/components/ui/field';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/components/ui/collapsible';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/shared/components/ui/dialog';
import { RecoveryStatus } from '@/shared/components/form/recovery-status';
import type { SessionHandle } from '@/shared/drafts/recovery-session';
import type { LoadedWorkspace } from '@/modules/workspace/contracts';
import { formSchema, hasChanges, toDraft } from '../model/form-model';
import type { PreferencesSnapshot } from '../model/contracts';
import type { PreferencesDraft } from '../model/schema';
import { usePreferencesSession } from '../client/use-preferences-session';
import { PreferencesFields } from './preferences-fields';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

export function PreferencesEditor({
	workspace,
	sessionId,
	snapshot,
	switching,
	onSession,
	onPublished,
}: LoadedWorkspace & {
	snapshot: PreferencesSnapshot;
	switching: boolean;
	onSession: (handle: SessionHandle | null) => void;
	onPublished?: (workspace: string) => void;
}) {
	const [initial] = useState(snapshot);
	const form = useForm<PreferencesDraft>({
		defaultValues: initial.draft?.values ?? toDraft(initial.preferences),
		resolver: zodResolver(formSchema),
	});
	const { session, act, busy, error } = usePreferencesSession({
		workspace,
		sessionId,
		initial,
		snapshot,
		form,
		onSession,
		onPublished,
	});
	const recovery = useSyncExternalStore(session.subscribe, session.getState, session.getState);
	const [open, setOpen] = useState(!initial.preferences || !!initial.draft);
	const [confirmation, setConfirmation] = useState<'discard' | 'reload' | null>(null);
	const disabled = busy || switching;
	return (
		<FieldGroup>
			<div className="flex flex-wrap gap-3">
				<Badge variant={snapshot.preferences ? 'default' : 'secondary'}>
					{snapshot.preferences ? 'Saved preferences available' : 'No saved preferences'}
				</Badge>
				{snapshot.draft ? <Badge variant="outline">Recovery draft</Badge> : null}
			</div>
			<FieldDescription>
				Your saved preferences change only after Save. Drafts can contain unfinished fields.
			</FieldDescription>
			<RecoveryStatus
				status={recovery.status}
				error={recovery.error}
				showMessage={!!snapshot.draft || session.hasPending()}
				retry={() => void session.retry().catch(() => {})}
				reload={() => setConfirmation('reload')}
				reloadLabel="Reload current preferences"
				disabled={disabled}
			/>
			<FieldError>{error}</FieldError>
			<Collapsible open={open} onOpenChange={setOpen}>
				<CollapsibleTrigger render={<Button variant="outline" />}>
					<ChevronDown className={cn(open && 'rotate-180', 'transition-all')} data-icon="inline-start" />
					Edit search preferences
				</CollapsibleTrigger>
				<CollapsibleContent keepMounted>
					<form
						className="flex flex-col gap-5 pt-5"
						noValidate
						onSubmit={(event) => {
							const target = event.currentTarget;
							void form.handleSubmit(
								() => act('publish'),
								() => {
									setOpen(true);
									requestAnimationFrame(() =>
										target.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
									);
								},
							)(event);
						}}
					>
						<fieldset disabled={disabled} className="flex min-w-0 flex-col gap-5">
							<PreferencesFields control={form.control} disabled={disabled} />
							<Actions
								control={form.control}
								baseline={recovery.baseline}
								hasDraft={!!snapshot.draft}
								busy={busy}
								discard={() => setConfirmation('discard')}
							/>
						</fieldset>
					</form>
				</CollapsibleContent>
			</Collapsible>
			<Dialog
				open={confirmation !== null}
				onOpenChange={(value) => {
					if (!value) setConfirmation(null);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{confirmation === 'reload' ? 'Reload current preferences?' : 'Discard this draft?'}
						</DialogTitle>
						<DialogDescription>
							{confirmation === 'reload'
								? 'Replace local edits with the current recovery draft or saved preferences from disk.'
								: 'Remove unsaved edits and restore saved preferences. Your saved configuration stays unchanged.'}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setConfirmation(null)}>
							Keep editing
						</Button>
						<Button
							disabled={disabled}
							onClick={() => {
								if (confirmation) act(confirmation);
								setConfirmation(null);
							}}
						>
							Continue
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</FieldGroup>
	);
}
function Actions({
	control,
	baseline,
	hasDraft,
	busy,
	discard,
}: {
	control: Control<PreferencesDraft>;
	baseline: PreferencesSnapshot['preferences'];
	hasDraft: boolean;
	busy: boolean;
	discard: () => void;
}) {
	const values = useWatch({ control }) as PreferencesDraft;
	const changed = hasChanges(values, baseline);
	return (
		<div className="flex flex-wrap gap-3">
			<Button type="submit" disabled={!changed && !!baseline} isInProgress={busy}>
				Save preferences
			</Button>
			<Button type="button" variant="outline" disabled={!changed && !hasDraft} onClick={discard}>
				Discard draft
			</Button>
		</div>
	);
}
