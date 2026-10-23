'use client';

import { Fragment, useMemo, useState } from 'react';
import {
	useTable,
	type ColumnVisibilityState,
	type ExpandedState,
	type PaginationState,
	type SortingState,
} from '@tanstack/react-table';

import { Input } from '@/shared/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/components/ui/table';
import { ApplicationCriteria } from './application-criteria';
import { applicationColumns, type RowActionHandlers } from './applications-columns';
import { applicationsTableFeatures } from './applications-table-features';
import { ApplicationsTablePagination } from './applications-table-pagination';
import { ApplicationsTableViewOptions } from './applications-table-view-options';
import { filterRows, type ApplicationRow, type StatusFilter } from './rows';
import { OptionSelect, statusFilterOptions } from './status-select';

export function ApplicationsTable({ rows, actions }: { rows: ApplicationRow[]; actions: RowActionHandlers }) {
	const [filter, setFilter] = useState('');
	const [status, setStatus] = useState<StatusFilter>('active');
	// Empty sorting keeps the default order `toRows` already applied.
	const [sorting, setSorting] = useState<SortingState>([]);
	// One source so far, and Found already says how fresh a row is.
	const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>({
		source: false,
		published: false,
	});
	const [expanded, setExpanded] = useState<ExpandedState>({});
	const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });
	const data = useMemo(() => filterRows(rows, filter, status), [rows, filter, status]);
	const columns = useMemo(() => applicationColumns(actions), [actions]);

	const table = useTable({
		features: applicationsTableFeatures,
		data,
		columns,
		// Fingerprints keep expansion and paging stable while a run refreshes the rows.
		getRowId: (row) => row.id,
		getRowCanExpand: () => true,
		autoResetPageIndex: false,
		autoResetExpanded: false,
		onSortingChange: setSorting,
		onColumnVisibilityChange: setColumnVisibility,
		onExpandedChange: setExpanded,
		onPaginationChange: setPagination,
		state: { sorting, columnVisibility, expanded, pagination },
	});

	return (
		<div>
			<div className="flex items-center gap-2 pb-4">
				<Input
					placeholder="Filter by title or company"
					aria-label="Filter by title or company"
					value={filter}
					onChange={(event) => {
						setFilter(event.target.value);
						table.setPageIndex(0);
					}}
					className="max-w-sm"
				/>
				<OptionSelect
					value={status}
					options={statusFilterOptions}
					label="Filter by status"
					className="w-40"
					onChange={(value) => {
						setStatus(value);
						table.setPageIndex(0);
					}}
				/>
				<ApplicationsTableViewOptions table={table} />
			</div>
			<div className="overflow-hidden rounded-md border">
				<Table>
					<TableHeader>
						{table.getHeaderGroups().map((headerGroup) => (
							<TableRow key={headerGroup.id}>
								{headerGroup.headers.map((header) => (
									<TableHead key={header.id}>
										{header.isPlaceholder ? null : <table.FlexRender header={header} />}
									</TableHead>
								))}
							</TableRow>
						))}
					</TableHeader>
					<TableBody>
						{table.getRowModel().rows.length ? (
							table.getRowModel().rows.map((row) => (
								<Fragment key={row.id}>
									<TableRow>
										{row.getVisibleCells().map((cell) => (
											<TableCell key={cell.id}>
												<table.FlexRender cell={cell} />
											</TableCell>
										))}
									</TableRow>
									{row.getIsExpanded() ? (
										<TableRow className="hover:bg-transparent">
											<TableCell
												colSpan={row.getVisibleCells().length}
												className="bg-muted/30 px-12 py-3"
											>
												<ApplicationCriteria
													criteria={row.original.criteria}
													manual={row.original.origin === 'manual'}
												/>
											</TableCell>
										</TableRow>
									) : null}
								</Fragment>
							))
						) : (
							<TableRow>
								<TableCell colSpan={table.getVisibleLeafColumns().length} className="h-24 text-center">
									No applications match the filters.
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>
			<div className="py-4">
				<ApplicationsTablePagination table={table} />
			</div>
		</div>
	);
}
