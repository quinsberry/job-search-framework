'use client';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/shared/components/ui/dialog';
import { Button } from '@/shared/components/ui/button';
export type Confirmation = { action: 'upload'; file: File } | { action: 'discard' | 'reload' };
export function ProfileConfirmation({
	choice,
	close,
	confirm,
}: {
	choice: Confirmation | null;
	close: () => void;
	confirm: (choice: Confirmation) => void;
}) {
	return (
		<Dialog
			open={!!choice}
			onOpenChange={(open) => {
				if (!open) close();
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{choice?.action === 'upload'
							? 'Replace the current draft?'
							: choice?.action === 'reload'
								? 'Reload current profile?'
								: 'Discard this draft?'}
					</DialogTitle>
					<DialogDescription>
						{choice?.action === 'upload'
							? 'A successful conversion replaces your unsaved draft. Your saved profile remains unchanged until Save.'
							: choice?.action === 'reload'
								? 'This replaces local edits with the current recovery draft or saved profile from disk.'
								: 'Unsaved edits will be removed. Your saved profile and reusable conversion results remain.'}
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="outline" onClick={close}>
						Keep editing
					</Button>
					<Button
						onClick={() => {
							if (choice) {
								close();
								confirm(choice);
							}
						}}
					>
						Continue
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
