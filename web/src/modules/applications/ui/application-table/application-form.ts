import type { ApplicationStatus } from '../model/contracts';
import type { ApplicationRow } from './rows';

// The dialog edits every field as text; the contracts' schemas turn empty text back into null.
export type ApplicationForm = {
	status: ApplicationStatus;
	expectedSalary: string;
	url: string;
	title: string;
	company: string;
	location: string;
	salary: string;
};
export function formDefaults(row: ApplicationRow | null): ApplicationForm {
	return {
		status: row?.status ?? 'new',
		expectedSalary: row?.expectedSalary ?? '',
		url: row?.url ?? '',
		title: row?.title ?? '',
		company: row?.company ?? '',
		location: row?.location ?? '',
		salary: row?.salary ?? '',
	};
}
