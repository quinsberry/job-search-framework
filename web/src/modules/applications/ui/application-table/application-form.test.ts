import { expect, test } from 'bun:test';
import type { SearchApplication } from '../model/contracts';
import { formDefaults } from './application-form';
import { toRow } from './rows';

const sources = [{ id: 'linkedin' as const, name: 'LinkedIn', supportedFilters: [] }];
const application: SearchApplication = {
	origin: 'search',
	fingerprint: '1'.padStart(64, '0'),
	status: 'new',
	expectedSalary: null,
	addedAt: '2026-10-22T00:00:00Z',
	job: {
		sourceId: 'linkedin',
		sourceJobId: '1',
		url: 'https://www.linkedin.com/jobs/view/1',
		title: 'Engineer 1',
		company: { name: 'Acme', url: null },
		locations: [],
		publishedAt: null,
		observedAt: '2026-10-20T00:00:00Z',
		availability: 'open',
	},
	match: { outcome: 'needs-clarification', criteria: [], costUsd: null },
};

test('form defaults edit every field as text', () => {
	expect(formDefaults(null)).toEqual({
		status: 'new',
		expectedSalary: '',
		url: '',
		title: '',
		company: '',
		location: '',
		salary: '',
	});
	const row = toRow({ ...application, status: 'offer', expectedSalary: '25k' }, sources);
	expect(formDefaults(row)).toMatchObject({
		status: 'offer',
		expectedSalary: '25k',
		title: 'Engineer 1',
		company: 'Acme',
	});
});
