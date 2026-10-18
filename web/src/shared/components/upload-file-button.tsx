'use client';

import { Upload } from 'lucide-react';
import { type ChangeEvent, useRef } from 'react';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';

export function UploadFileButton({
	onFileSelect,
	accept,
	disabled,
	label = 'Upload File',
}: {
	onFileSelect: (file: File) => void;
	accept?: string;
	disabled?: boolean;
	label?: string;
}) {
	const inputRef = useRef<HTMLInputElement>(null);

	const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.currentTarget.files?.[0];
		// Allow the same file to be selected again.
		event.currentTarget.value = '';
		if (file) {
			onFileSelect(file);
		}
	};

	return (
		<>
			<Input
				ref={inputRef}
				type="file"
				hidden
				aria-label={label}
				accept={accept}
				disabled={disabled}
				onChange={handleFileChange}
			/>
			<Button type="button" variant="outline" disabled={disabled} onClick={() => inputRef.current?.click()}>
				<Upload data-icon="inline-start" />
				{label}
			</Button>
		</>
	);
}
