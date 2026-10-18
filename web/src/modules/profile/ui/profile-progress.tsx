'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Loader } from 'lucide-react';
import { FieldDescription, FieldError } from '@/shared/components/ui/field';
import { Button } from '@/shared/components/ui/button';
import { processing, type ConversionJob } from '../model/contracts';
import type { RecoverySession } from '../client/recovery-session';
export function ProfileProgress({ job, busy }: { job: ConversionJob | null; busy: boolean }) {
	const [now, setNow] = useState(() => Date.now());
	const active = processing(job);
	// The progress display is the sole owner of the elapsed-time clock.
	useEffect(() => {
		if (!active) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [active]);
	const elapsed = job ? Math.max(0, Math.floor((now - job.startedAt) / 1000)) : 0;
	return (
		<div role="status" aria-live="polite">
			{busy ? (
				<p className="flex items-center gap-2">
					<Loader className="size-4 animate-spin" aria-hidden="true" />
					Working…
				</p>
			) : null}
			{active ? (
				<p className="flex items-center gap-2">
					<Loader className="size-4 animate-spin" aria-hidden="true" />
					{job?.phase === 'reading'
						? 'Reading CV'
						: job?.phase === 'converting'
							? 'Converting CV into profile fields'
							: 'Validating converted fields'}{' '}
					· {elapsed}s
				</p>
			) : null}
			{active && elapsed >= 30 ? (
				<FieldDescription>
					This can take a few minutes. You can leave this page; completed results are saved for recovery.
				</FieldDescription>
			) : null}
		</div>
	);
}
const messages = {
	clean: 'Draft saved for recovery',
	pending: 'Changes waiting for recovery save…',
	writing: 'Saving recovery draft…',
	failed: 'Recovery failed; recent edits are only in this page',
	conflicted: 'Profile changed; your edits are retained',
};
export function RecoveryStatus({
	session,
	reload,
	showMessage = true,
}: {
	session: RecoverySession;
	reload: () => void;
	showMessage?: boolean;
}) {
	const state = useSyncExternalStore(session.subscribe, session.getState, session.getState);
	return (
		<>
			{showMessage ? <FieldDescription role="status">{messages[state.status]}</FieldDescription> : null}
			<FieldError>{state.error}</FieldError>
			{state.status === 'conflicted' ? (
				<Button variant="outline" onClick={reload}>
					Reload current profile
				</Button>
			) : null}
			{state.status === 'failed' ? (
				<Button variant="outline" onClick={() => void session.retry().catch(() => {})}>
					Retry draft recovery
				</Button>
			) : null}
		</>
	);
}
