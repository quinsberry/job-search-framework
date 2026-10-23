import type {
	Application,
	ApplicationStatus,
	LoadResult,
	SearchApplication,
	Assessment,
	ExpectedSalary,
} from '../../model/contracts';

export type Criterion = Assessment['match']['criteria'][number];
type Job = SearchApplication['job'];

// Display rules live here so the components only render; columns never read MatchResult internals.
export type ApplicationRow = {
	id: string;
	origin: Application['origin'];
	status: ApplicationStatus;
	expectedSalary: ExpectedSalary;
	expectedSalaryLabel: string | null;
	workArrangementOverride: SearchApplication['workArrangementOverride'];
	title: string;
	url: string;
	company: string | null;
	location: string | null;
	arrangement: string | null;
	salary: string | null;
	outcome: SearchApplication['match']['outcome'] | 'manual';
	openQuestions: string[];
	salaryNotAdvertised: boolean;
	source: string;
	publishedAt: string | null;
	addedAt: string;
	criteria: Criterion[];
};

export const criterionLabel: Record<Criterion['criterion'], string> = {
	availability: 'availability',
	salary: 'salary',
	workArrangement: 'work arrangement',
	location: 'location',
	role: 'role',
	seniority: 'seniority',
	positionType: 'position type',
	skills: 'skills',
};

const more = (count: number) => (count > 1 ? ` +${count - 1}` : '');

const periods = { annual: ' / year', month: ' / month', hourly: ' / hour', unknown: '' };
const money = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const expectedMoney = new Intl.NumberFormat('en-US', { maximumFractionDigits: 20 });
export function expectedSalaryLabel(value: ExpectedSalary): string | null {
	return value === null || typeof value === 'string'
		? value
		: `${expectedMoney.format(value.amount)} ${value.currency}${periods[value.period]} ${value.contractType}`;
}
export function salaryOf(job: Job): string | null {
	const all = job.advertisedFacts?.compensation ?? [];
	const first = all[0];
	if (!first) return null;
	const { min, max } = first;
	const range =
		min !== null && max !== null
			? min === max
				? money.format(min)
				: `${money.format(min)}–${money.format(max)}`
			: min !== null
				? `from ${money.format(min)}`
				: max !== null
					? `up to ${money.format(max)}`
					: null;
	return (range === null ? first.rawText : `${range} ${first.currency}${periods[first.period]}`) + more(all.length);
}

export function toRow(application: LoadResult['applications'][number], sources: LoadResult['sources']): ApplicationRow {
	const tracked = {
		id: application.fingerprint,
		origin: application.origin,
		status: application.status,
		expectedSalary: application.expectedSalary,
		expectedSalaryLabel: expectedSalaryLabel(application.expectedSalary),
		workArrangementOverride: application.origin === 'search' ? application.workArrangementOverride : undefined,
		addedAt: application.addedAt,
	};
	if (application.origin === 'manual')
		return {
			...tracked,
			title: application.title,
			url: application.url,
			company: application.company,
			location: application.location,
			arrangement: null,
			salary: application.salary,
			outcome: 'manual',
			openQuestions: [],
			salaryNotAdvertised: false,
			source: 'Manual',
			publishedAt: null,
			criteria: [],
		};
	const { job, assessment } = application;
	const { match } = assessment;
	const salary = salaryOf(job);
	const unknown = match.criteria.filter((item) => item.result === 'unknown');
	// An unadvertised salary is expected on most sources, so it is not counted as an open question.
	const salaryNotAdvertised = !salary && unknown.some((item) => item.criterion === 'salary');
	return {
		...tracked,
		title: job.title,
		url: job.url,
		company: job.company?.name ?? null,
		location: job.locations[0] ? job.locations[0].label + more(job.locations.length) : null,
		arrangement: assessment.workArrangements?.join(' / ') ?? null,
		salary,
		outcome: match.outcome,
		openQuestions: unknown
			.filter((item) => !(salaryNotAdvertised && item.criterion === 'salary'))
			.map((item) => criterionLabel[item.criterion]),
		salaryNotAdvertised,
		source: sources.find((source) => source.id === job.sourceId)?.name ?? job.sourceId,
		publishedAt: job.publishedAt,
		criteria: match.criteria,
	};
}

// Default order: matches and hand-picked rows first, then the fewest open questions, then the newest.
export function toRows({ applications, sources }: LoadResult): ApplicationRow[] {
	return applications
		.map((application) => toRow(application, sources))
		.sort(
			(a, b) =>
				Number(b.outcome !== 'needs-clarification') - Number(a.outcome !== 'needs-clarification') ||
				a.openQuestions.length - b.openQuestions.length ||
				b.addedAt.localeCompare(a.addedAt),
		);
}

export const statusLabels: Record<ApplicationStatus, string> = {
	new: 'New',
	applied: 'Applied',
	interviewing: 'Interviewing',
	offer: 'Offer',
	rejected: 'Rejected',
	dismissed: 'Dismissed',
};
// Rejected and dismissed rows are hidden by default but never lost.
const active = new Set<ApplicationStatus>(['new', 'applied', 'interviewing', 'offer']);
export type StatusFilter = 'active' | 'all' | ApplicationStatus;
export const statusFilterLabels: Record<StatusFilter, string> = { active: 'Active', all: 'All', ...statusLabels };

export function filterRows(rows: ApplicationRow[], text: string, status: StatusFilter = 'all') {
	const needle = text.trim().toLowerCase();
	return rows.filter(
		(row) =>
			(status === 'all' || (status === 'active' ? active.has(row.status) : row.status === status)) &&
			(!needle || `${row.title}\n${row.company ?? ''}`.toLowerCase().includes(needle)),
	);
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const DAY = 24 * 60 * 60 * 1000;
export function relativeDate(iso: string, now = new Date()) {
	const days = Math.round((Date.parse(iso) - now.getTime()) / DAY);
	return Math.abs(days) < 60 ? relative.format(days, 'day') : relative.format(Math.round(days / 30), 'month');
}
