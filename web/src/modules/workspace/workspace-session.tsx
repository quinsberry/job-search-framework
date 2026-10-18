'use client';
import { useEffect, useEffectEvent, useCallback, useState } from 'react';
import { request } from '@/shared/http/client';
import { workspaceSchema, type LoadedWorkspace } from './contracts';
const rememberedKey = 'candidate-profile.workspace.v1';
export const validateWorkspace = (workspace: string) => request('/api/workspace', { workspace }, workspaceSchema);
export function useWorkspaceSession(open: (directory: string) => Promise<void>) {
	const [loaded, setLoaded] = useState<LoadedWorkspace | null>(null);
	const restore = useEffectEvent(open);
	// Synchronizes the remembered folder with the application once on mount.
	useEffect(() => {
		let directory: string | null = null;
		try {
			directory = localStorage.getItem(rememberedKey);
		} catch {
			/* Remembering is optional. */
		}
		const timer = directory ? setTimeout(() => void restore(directory!), 0) : null;
		return () => {
			if (timer) clearTimeout(timer);
		};
	}, []);
	const accept = useCallback((workspace: LoadedWorkspace) => {
		setLoaded(workspace);
		try {
			localStorage.setItem(rememberedKey, workspace.workspace);
		} catch {
			/* Remembering is optional. */
		}
	}, []);
	return { loaded, accept };
}
