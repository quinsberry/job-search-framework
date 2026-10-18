import { ActiveAgentSection } from '@/modules/active-agent-section';
import { DataTable } from '@/modules/applications/application-table';
import { columns, Payment } from '@/modules/applications/application-table/columns';
import { CandidateProfile } from '@/modules/profile/candidate-profile';
import { WorkspaceSection } from '@/modules/workspace-section';

async function getData(): Promise<Payment[]> {
    // Fetch data from your API here.
    return [
        {
            id: '728ed52f',
            amount: 100,
            status: 'pending',
            email: 'm@example.com',
        },
        {
            id: '728ed53f',
            amount: 20,
            status: 'success',
            email: 'john.doe@example.com',
        },
        {
            id: '728ed51f',
            amount: 30,
            status: 'processing',
            email: 'jane.smith@example.com',
        },
        {
            id: '728ed41f',
            amount: 120,
            status: 'failed',
            email: 'jane.smith@example.com',
        },
    ];
}

export default async function Home() {
    const data = await getData();

    return (
        <div className="container mx-auto py-10 space-y-4">
            <WorkspaceSection />
            <ActiveAgentSection />
            <CandidateProfile />
            <DataTable columns={columns} data={data} />
        </div>
    );
}
