import { z } from 'zod';
import {
	changesSchemas,
	manualInputSchema,
	expectedSalarySchema,
	structuredSalarySchema,
	type ApplicationStatus,
	type SearchApplication,
} from '../../model/contracts';
import type { ApplicationRow } from './rows';

export type ApplicationForm = {
	status: ApplicationStatus;
	expectedSalary: string | null | { amount: string; currency: string; period: string; contractType: string };
	workArrangementOverride: SearchApplication['workArrangementOverride'];
	url: string;
	title: string;
	company: string;
	location: string;
	salary: string;
};

export function applicationFormSchema(origin: 'search' | 'manual' | 'new') {
	const schema = origin === 'new' ? manualInputSchema : changesSchemas[origin];
	const salary = structuredSalarySchema.extend({
		amount: z.string().trim().min(1, 'Enter an amount').transform(Number).pipe(structuredSalarySchema.shape.amount),
		currency: z.string().min(1, 'Choose a currency').pipe(structuredSalarySchema.shape.currency),
		period: z.string().min(1, 'Choose a pay period').pipe(structuredSalarySchema.shape.period),
		contractType: z.string().min(1, 'Choose a contract type').pipe(structuredSalarySchema.shape.contractType),
	});
	return z.object(schema.shape).extend({
		expectedSalary: z.unknown().transform((value, context) => {
			const result = (typeof value === 'string' || value === null ? expectedSalarySchema : salary).safeParse(
				value,
			);
			if (result.success) return result.data;
			for (const issue of result.error.issues)
				context.addIssue({ code: 'custom', path: issue.path, message: issue.message });
			return z.NEVER;
		}),
	});
}

export function formDefaults(row: ApplicationRow | null): ApplicationForm {
	const salary = row?.expectedSalary ?? null;
	return {
		status: row?.status ?? 'new',
		expectedSalary:
			salary !== null && typeof salary === 'object' ? { ...salary, amount: String(salary.amount) } : salary,
		workArrangementOverride: row?.workArrangementOverride ?? null,
		url: row?.url ?? '',
		title: row?.title ?? '',
		company: row?.company ?? '',
		location: row?.location ?? '',
		salary: row?.salary ?? '',
	};
}
