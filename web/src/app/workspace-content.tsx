'use client';
import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { WorkspaceSection } from '@/modules/workspace/workspace-section';
import { useWorkspaceSession, validateWorkspace } from '@/modules/workspace/workspace-session';
import { AgentSession, useAgent } from '@/modules/agent/agent-session';
import type { ComponentProps } from 'react';
import { ActiveAgentSection } from '@/modules/agent/agent-section';
import { ProfileSection, type ProfileHandle } from '@/modules/profile/profile-section';
import { profileOptions } from '@/modules/profile/client/queries';
import { SearchPreferencesSection } from '@/modules/search/search-preferences-section';

export function WorkspaceContent() {
	const client = useQueryClient();
	const profile = useRef<ProfileHandle | null>(null);
	const opening = useRef(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');
	const session = useWorkspaceSession(open);
	async function open(directory: string) {
		if (opening.current) return;
		opening.current = true;
		setLoading(true);
		setError('');
		try {
			await profile.current?.prepareToLeave();
			const result = await validateWorkspace(directory);
			const target = { workspace: result.workspace, sessionId: crypto.randomUUID() };
			// Validate profile storage before replacing the active workspace and its editor.
			await client.fetchQuery(profileOptions(target.workspace, target.sessionId));
			profile.current?.dispose();
			session.accept(target);
		} catch (error) {
			setError(error instanceof Error ? error.message : 'Could not load workspace.');
		} finally {
			opening.current = false;
			setLoading(false);
		}
	}
	const attach = useCallback((handle: ProfileHandle | null) => {
		profile.current = handle;
	}, []);
	return (
		<AgentSession>
			<WorkspaceSection
				workspace={session.loaded?.workspace ?? null}
				loading={loading}
				workspaceError={error}
				loadWorkspace={open}
			/>
			<ActiveAgentSection />
			<ConnectedProfile
				key={session.loaded?.sessionId ?? 'empty'}
				loaded={session.loaded}
				switching={loading}
				onSession={attach}
			/>
			<SearchPreferencesSection />
		</AgentSession>
	);
}
function ConnectedProfile(props: Omit<ComponentProps<typeof ProfileSection>, 'provider' | 'connection'>) {
	const { provider, connection } = useAgent();
	return <ProfileSection {...props} provider={provider} connection={connection} />;
}
