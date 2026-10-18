'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/components/ui/card';

export function CandidateProfile() {
    const handleSetupProfile = () => {
        console.log(`Setting up profile for agent: ${selectedAgent}`);
    };
    const handleEditProfile = () => {
        console.log(`Editing profile for agent: ${selectedAgent}`);
    };
    return (
        <Card>
            <CardHeader>
                <CardTitle>Candidate Profile</CardTitle>
                <CardDescription>Manage your candidate profile information.</CardDescription>
            </CardHeader>
            <CardContent></CardContent>
        </Card>
    );
}
