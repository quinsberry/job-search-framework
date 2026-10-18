import { z } from 'zod';
export const workspaceSchema = z.object({ workspace: z.string() });
export type LoadedWorkspace = { workspace: string; sessionId: string };
