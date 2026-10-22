'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { type ApplicationsTableFeatures } from './applications-table-features';
import { ApplicationsTableColumnHeader } from './applications-table-column-header';
import { relativeDate, type ApplicationRow } from './rows';

const columnHelper = createColumnHelper<ApplicationsTableFeatures, ApplicationRow>();
const muted = (text: string) => <span className="text-muted-foreground">{text}</span>;
const date = (iso: string | null) =>
	iso ? (
		<time dateTime={iso} title={new Date(iso).toLocaleString()}>
			{relativeDate(iso)}
		</time>
	) : (
		muted('—')
	);
const truncated = (text: string) => (
	<span className="block max-w-56 truncate" title={text}>
		{text}
	</span>
);

// Column ids double as labels in the view options menu.
export const applicationColumns = columnHelper.columns([
	columnHelper.display({
		id: 'expand',
		cell: ({ row }) => (
			<Button
				variant="ghost"
				size="icon-sm"
				aria-expanded={row.getIsExpanded()}
				aria-label="Show criteria"
				onClick={() => row.toggleExpanded()}
			>
				{row.getIsExpanded() ? <ChevronDown /> : <ChevronRight />}
			</Button>
		),
		enableSorting: false,
		enableHiding: false,
	}),
	columnHelper.accessor('title', {
		header: ({ column }) => <ApplicationsTableColumnHeader column={column} title="Title" />,
		cell: ({ row }) => (
			<a
				href={row.original.url}
				target="_blank"
				rel="noopener noreferrer"
				className="inline-flex max-w-72 items-center gap-1 font-medium hover:underline"
				title={row.original.title}
			>
				<span className="truncate">{row.original.title}</span>
				<ExternalLink aria-hidden className="size-3 shrink-0" />
				<span className="sr-only">(opens in a new tab)</span>
			</a>
		),
		enableHiding: false,
	}),
	// Missing values become undefined so sorting puts them last instead of comparing null.
	columnHelper.accessor((row) => row.company ?? undefined, {
		id: 'company',
		header: ({ column }) => <ApplicationsTableColumnHeader column={column} title="Company" />,
		cell: ({ getValue }) => {
			const company = getValue();
			return company ? truncated(company) : muted('—');
		},
		sortUndefined: 'last',
	}),
	columnHelper.accessor('location', {
		header: 'Location',
		cell: ({ getValue }) => {
			const location = getValue();
			return location ? truncated(location) : muted('—');
		},
		enableSorting: false,
	}),
	columnHelper.accessor('arrangement', {
		header: 'Arrangement',
		cell: ({ getValue }) => (
			<span className="inline-block first-letter:uppercase">{getValue() ?? muted('Unknown')}</span>
		),
		enableSorting: false,
	}),
	columnHelper.accessor('salary', {
		header: 'Salary',
		cell: ({ getValue }) => getValue() ?? muted('Not advertised'),
		enableSorting: false,
	}),
	columnHelper.accessor('outcome', {
		header: ({ column }) => <ApplicationsTableColumnHeader column={column} title="Outcome" />,
		cell: ({ getValue }) =>
			getValue() === 'match' ? <Badge>Match</Badge> : <Badge variant="secondary">Needs clarification</Badge>,
	}),
	columnHelper.accessor('openQuestions', {
		id: 'open questions',
		header: 'Open questions',
		cell: ({ row }) => {
			const { openQuestions, salaryNotAdvertised } = row.original;
			if (!openQuestions.length && !salaryNotAdvertised) return muted('—');
			return (
				<span>
					{openQuestions.join(', ')}
					{openQuestions.length && salaryNotAdvertised ? ', ' : null}
					{salaryNotAdvertised ? muted('salary not advertised') : null}
				</span>
			);
		},
		enableSorting: false,
	}),
	columnHelper.accessor('source', {
		header: ({ column }) => <ApplicationsTableColumnHeader column={column} title="Source" />,
	}),
	columnHelper.accessor((row) => row.publishedAt ?? undefined, {
		id: 'published',
		header: ({ column }) => <ApplicationsTableColumnHeader column={column} title="Published" />,
		cell: ({ getValue }) => date(getValue() ?? null),
		sortFn: 'datetime',
		sortUndefined: 'last',
	}),
	columnHelper.accessor('matchedAt', {
		id: 'found',
		header: ({ column }) => <ApplicationsTableColumnHeader column={column} title="Found" />,
		cell: ({ getValue }) => date(getValue()),
		sortFn: 'datetime',
	}),
]);
