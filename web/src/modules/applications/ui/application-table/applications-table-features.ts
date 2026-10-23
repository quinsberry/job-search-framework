import {
	columnVisibilityFeature,
	createPaginatedRowModel,
	createSortedRowModel,
	rowExpandingFeature,
	rowPaginationFeature,
	rowSortingFeature,
	sortFn_alphanumeric,
	sortFn_datetime,
	sortFn_text,
	tableFeatures,
} from '@tanstack/react-table';

// New in v9: declare the features this table uses — anything you don't
// register is tree-shaken out of the bundle.
export const applicationsTableFeatures = tableFeatures({
	columnVisibilityFeature,
	rowExpandingFeature,
	rowPaginationFeature,
	rowSortingFeature,
	paginatedRowModel: createPaginatedRowModel(),
	sortedRowModel: createSortedRowModel(),
	sortFns: { alphanumeric: sortFn_alphanumeric, datetime: sortFn_datetime, text: sortFn_text },
});

// Pass this as the first generic argument to `ColumnDef`, `Column`, `Table`,
// and `Row` so each type knows which feature APIs are available.
export type ApplicationsTableFeatures = typeof applicationsTableFeatures;
