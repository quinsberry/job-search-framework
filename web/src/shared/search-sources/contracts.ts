import z from "zod";

export const readinessSchema = z.object({
    available: z.boolean(),
    message: z.string(),
    cacheIdentity: z.string(),
});
export type ProviderReadiness = z.infer<typeof readinessSchema>;


export interface SearchOptions {
    query?: string;
    location: string;
    jobage: number;
    jobageMinutes?: number;
    // remote?: WorkType;
    page: number;
    limit?: number;
}

export interface SearchSourceProvider {
    readonly id: string;
    check(): Promise<ProviderReadiness>;
    search({}: SearchOptions): Promise<unknown>;
}