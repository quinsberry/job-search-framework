'use client';
import type { RecoveryStatus as Status } from '@/shared/drafts/recovery-session';
import { FieldDescription, FieldError } from '@/shared/components/ui/field';
import { Button } from '@/shared/components/ui/button';
const messages: Record<Status, string> = {
	clean: 'Draft saved for recovery',
	pending: 'Changes waiting for recovery save…',
	writing: 'Saving recovery draft…',
	failed: 'Recovery failed; recent edits are only in this page',
	conflicted: 'Data changed; your edits are retained',
};
export function RecoveryStatus({
	status,
	error,
	retry,
	reload,
	reloadLabel,
	showMessage = true,
	disabled = false,
}: {
	status: Status;
	error: string;
	retry: () => void;
	reload: () => void;
	reloadLabel: string;
	showMessage?: boolean;
	disabled?: boolean;
}) {
	return (
		<>
			{showMessage ? <FieldDescription role="status">{messages[status]}</FieldDescription> : null}
			<FieldError>{error}</FieldError>
			{status === 'conflicted' ? (
				<Button disabled={disabled} variant="outline" onClick={reload}>
					{reloadLabel}
				</Button>
			) : null}
			{status === 'failed' ? (
				<Button disabled={disabled} variant="outline" onClick={retry}>
					Retry draft recovery
				</Button>
			) : null}
		</>
	);
}
