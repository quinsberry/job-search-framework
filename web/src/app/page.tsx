import { WorkspaceContent } from './workspace-content';
import { Providers } from './providers';

export default function Home() {
	return (
		<div className="container mx-auto py-10 space-y-4">
			<Providers>
				<WorkspaceContent />
			</Providers>
		</div>
	);
}
