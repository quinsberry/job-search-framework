'use client';

import { SelectDirectoryButton } from '@/shared/components/select-directory-button';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Field } from '@/shared/components/ui/field';
import { useState } from 'react';
import { FieldDescription, FieldError } from '@/shared/components/ui/field';

export function WorkspaceSection({
	workspace,
	loading,
	workspaceError,
	loadWorkspace,
}: {
	workspace: string | null;
	loading: boolean;
	workspaceError: string;
	loadWorkspace: (directory: string) => Promise<void>;
}) {
	const [directory, setDirectory] = useState<string | null>(null);
	return (
		<Card>
			<CardHeader>
				<CardTitle>Workspace folder</CardTitle>
				<CardDescription>Choose where your candidate profile and CV drafts are stored.</CardDescription>
			</CardHeader>
			<CardContent>
				<Field orientation="horizontal">
					<SelectDirectoryButton onSelect={(path) => setDirectory(path)}>
						{directory ?? 'Select workspace'}
					</SelectDirectoryButton>
					<Button
						disabled={!directory}
						isInProgress={loading}
						onClick={() => directory && void loadWorkspace(directory)}
					>
						Load Workspace
					</Button>
				</Field>
				<FieldDescription>{workspace ? `Loaded: ${workspace}` : 'No workspace loaded.'}</FieldDescription>
				<FieldError>{workspaceError}</FieldError>
			</CardContent>
		</Card>
	);
}
