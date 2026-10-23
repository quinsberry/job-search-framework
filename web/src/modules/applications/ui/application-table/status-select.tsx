'use client';
import { applicationStatuses } from '../../model/contracts';
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/shared/components/ui/select';
import { statusFilterLabels, statusLabels, type StatusFilter } from './rows';

type Option<T extends string> = { value: T; label: string };
export const statusOptions = applicationStatuses.map((value) => ({ value, label: statusLabels[value] }));
export const statusFilterOptions = Object.entries(statusFilterLabels).map(([value, label]) => ({
	value: value as StatusFilter,
	label,
}));

// One labelled select over fixed options; used for a row's status and for the status filter.
export function OptionSelect<T extends string>({
	value,
	options,
	onChange,
	label,
	disabled,
	id,
	className,
	invalid,
}: {
	value: T;
	options: Option<T>[];
	onChange: (value: T) => void;
	label: string;
	disabled?: boolean;
	id?: string;
	className?: string;
	invalid?: boolean;
}) {
	return (
		<Select
			value={value || null}
			disabled={disabled}
			items={options}
			onValueChange={(next) => {
				if (next && next !== value) onChange(next as T);
			}}
		>
			<SelectTrigger id={id} aria-label={label} aria-invalid={invalid} className={className}>
				<SelectValue placeholder="Choose an option" />
			</SelectTrigger>
			<SelectContent>
				<SelectGroup>
					{options.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							{option.label}
						</SelectItem>
					))}
				</SelectGroup>
			</SelectContent>
		</Select>
	);
}
