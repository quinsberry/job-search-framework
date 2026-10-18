'use client';

import { Button } from '@/shared/components/ui/button';
import { FolderOpen, Loader } from 'lucide-react';
import { useState } from 'react';
import { selectDirectory } from '@/shared/actions/select-directory';

export function SelectDirectoryButton({
	children,
	onSelect,
}: {
	children?: React.ReactNode;
	onSelect?: (path: string) => void;
}) {
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	const handleButtonClick = async () => {
		setError(null);
		setPending(true);
		try {
			const path = await selectDirectory();
			if (path !== null) {
				onSelect?.(path);
			}
		} catch {
			setError('Could not select a folder. Run the app locally with Bun and try again.');
		} finally {
			setPending(false);
		}
	};

	return (
		<div>
			<Button type="button" variant="outline" disabled={pending} onClick={handleButtonClick}>
				{pending ? <Loader className="animate-spin" /> : <FolderOpen data-icon="inline-start" />}
				{children ?? 'Select folder'}
			</Button>
			{error && <p role="alert">{error}</p>}
		</div>
	);
}
