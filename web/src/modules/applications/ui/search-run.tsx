'use client';
import { LoaderCircle, Search } from 'lucide-react';
import { cn } from 'cn';
import { Button } from '@/shared/components/ui/button';
import { runStatusLine, type RunState } from './run-status';

export function SearchRunButton({
	status,
	start,
	cancel,
}: {
	status: RunState['status'];
	start: () => void;
	cancel: () => void;
}) {
	return status === 'running' ? (
		// Cancelling keeps every application already found, so it needs no confirmation.
		<Button variant="outline" onClick={cancel}>
			<LoaderCircle aria-hidden className="animate-spin" />
			Cancel
		</Button>
	) : (
		<Button onClick={start}>
			<Search />
			Search
		</Button>
	);
}

export function SearchRunStatus(run: RunState) {
	const line = runStatusLine(run);
	return (
		<p
			role="status"
			aria-live="polite"
			className={cn('min-h-5 text-sm', line?.tone === 'error' ? 'text-destructive' : 'text-muted-foreground')}
		>
			{line?.text}
		</p>
	);
}
