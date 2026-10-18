'use client';

import { SelectDirectoryButton } from '@/shared/components/select-directory-button';
import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Field } from '@/shared/components/ui/field';
import { useState } from 'react';

export function WorkspaceSection() {
    const [directory, setDirectory] = useState<string | null>(null);
    const handleLoadWorkspace = () => {
        // Implement the logic to load the workspace here
        console.log(`Loading workspace from directory: ${directory}`);
    };
    return (
        <Card>
            <CardHeader>
                <CardTitle>Workspace folder</CardTitle>
                <CardDescription>Choose the folder containing your profile and search configuration.</CardDescription>
            </CardHeader>
            <CardContent>
                <Field orientation="horizontal">
                    <SelectDirectoryButton onSelect={(path) => setDirectory(path)}>
                        {directory ?? 'Select workspace'}
                    </SelectDirectoryButton>
                    <Button disabled={!directory} onClick={handleLoadWorkspace}>
                        Load Workspace
                    </Button>
                </Field>
            </CardContent>
        </Card>
    );
}
