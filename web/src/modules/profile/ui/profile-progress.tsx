'use client';
import { useEffect, useState } from 'react';
import { Loader } from 'lucide-react';
import { FieldDescription } from '@/shared/components/ui/field';
import { processing, type ConversionJob } from '../model/contracts';
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
