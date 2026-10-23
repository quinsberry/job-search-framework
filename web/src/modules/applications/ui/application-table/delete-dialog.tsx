'use client';
import { Button } from '@/shared/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/shared/components/ui/dialog';
import type { ApplicationRow } from './rows';

export function DeleteDialog({
	row,
	busy,
	onClose,
	onConfirm,
}: {
	row: ApplicationRow | null;
	busy: boolean;
	onClose: () => void;
	onConfirm: (row: ApplicationRow) => void;
}) {
	return (
		<Dialog open={row !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Delete application?</DialogTitle>
					<DialogDescription>
						“{row?.title}”{row?.company ? ` at ${row.company}` : ''} will be removed. Searches won&apos;t
						find it again.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button variant="destructive" isInProgress={busy} onClick={() => row && onConfirm(row)}>
						Delete
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
