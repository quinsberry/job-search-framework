'use client';

import { SelectDirectoryButton } from '@/shared/components/select-directory-button';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Field } from '@/shared/components/ui/field';
import { useState } from 'react';

export function SearchPreferencesSection() {
	const [directory, setDirectory] = useState<string | null>(null);
	const handleLoadWorkspace = () => {
		// Implement the logic to load the workspace here
		console.log(`Loading workspace from directory: ${directory}`);
	};
	return (
		<Card>
			<CardHeader>
				<CardTitle>Search Preferences</CardTitle>
				<CardDescription>Configure your search preferences and filters</CardDescription>
			</CardHeader>
			<CardContent>
				<Field orientation="horizontal">
					<SelectDirectoryButton onSelect={(path) => setDirectory(path)}>
						{directory ?? 'Select workspace'}
					</SelectDirectoryButton>
					<Button disabled={!directory} onClick={handleLoadWorkspace}>
						Save Preferences
					</Button>
				</Field>
			</CardContent>
		</Card>
	);
}
