import { z } from 'zod';

export const readinessSchema = z.object({
	available: z.boolean(),
	message: z.string(),
	cacheIdentity: z.string(),
});
export type ProviderReadiness = z.infer<typeof readinessSchema>;
export type InterpretationRequest = { instructions: string; inputText: string; outputSchema: Record<string, unknown> };
export interface AIProvider {
	readonly id: string;
	check(): Promise<ProviderReadiness>;
	interpret(request: InterpretationRequest, signal: AbortSignal): Promise<unknown>;
}
