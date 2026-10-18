import { z } from 'zod';

export const providerSchema = z.enum(['codex']);
export type Provider = z.infer<typeof providerSchema>;

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
