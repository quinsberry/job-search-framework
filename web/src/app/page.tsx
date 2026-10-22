import { AplicationsTable } from '@/modules/applications/application-table';
import { applicationColumns, Payment } from '@/modules/applications/application-table/applications-columns';
import { WorkspaceContent } from './workspace-content';
import { Providers } from './providers';

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
			<Providers>
				<WorkspaceContent />
			</Providers>
			<AplicationsTable columns={applicationColumns} data={data} />
		</div>
	);
}
