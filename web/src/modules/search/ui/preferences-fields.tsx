'use client';
import { useId } from 'react';
import { useController, useFieldArray, type Control, type FieldPathByValue } from 'react-hook-form';
import { TextField, ListField } from '@/shared/components/form/controls';
import { FieldSection } from '@/shared/components/form/field-section';
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from '@/shared/components/ui/field';
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/shared/components/ui/select';
import { Button } from '@/shared/components/ui/button';
import { fieldMessages } from '@/shared/lib/field-messages';
import {
	contractTypes,
	currencies,
	emptySalary,
	payPeriods,
	positionTypes,
	seniorities,
	workArrangements,
	type PreferencesDraft,
} from '../model/schema';
import {
	Combobox,
	ComboboxChip,
	ComboboxChips,
	ComboboxChipsInput,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxItem,
	ComboboxList,
	ComboboxValue,
	useComboboxAnchor,
} from '@/shared/components/ui/combobox';
import { cn } from '@/shared/lib/utils';
import { InputGroupAddon } from '@/shared/components/ui/input-group';
import { InfoTooltip } from '@/shared/components/info-hover';
import { Trash } from 'lucide-react';

type Props = { control: Control<PreferencesDraft>; className?: string; disabled?: boolean };
const labels: Record<string, string> = {
	junior: 'Junior',
	middle: 'Middle',
	senior: 'Senior',
	staff: 'Staff',
	'full-time': 'Full-time',
	'part-time': 'Part-time',
	contract: 'Contract',
	internship: 'Internship',
	remote: 'Remote',
	'on-site': 'On-site',
	hybrid: 'Hybrid',
	permanent: 'Permanent employment',
	B2B: 'B2B',
	annual: 'Annual',
	month: 'Monthly',
	hourly: 'Hourly',
};
function ChoiceGroup({
	control,
	name,
	label,
	options,
	disabled,
	className,
	info,
}: Props & {
	name: 'targetPosition.seniority' | 'targetPosition.positionType' | 'targetPosition.workArrangements';
	label: string;
	info?: string;
	options: readonly string[];
}) {
	const anchor = useComboboxAnchor();
	const { field, fieldState } = useController({ control, name });
	const id = useId();
	const values: readonly string[] = field.value;
	return (
		<FieldSet className={className}>
			<FieldLegend>{label}</FieldLegend>
			<FieldGroup className={cn('flex-row flex-wrap gap-4')}>
				<Combobox items={options} autoHighlight multiple value={values} onValueChange={field.onChange}>
					<ComboboxChips ref={anchor} className="w-full max-w-xs">
						{info && (
							<InputGroupAddon align="inline-end">
								<InfoTooltip>
									<p>{info}</p>
								</InfoTooltip>
							</InputGroupAddon>
						)}
						<ComboboxValue>
							{values.map((item) => (
								<ComboboxChip key={item}>{item}</ComboboxChip>
							))}
						</ComboboxValue>
						<ComboboxChipsInput />
					</ComboboxChips>
					<ComboboxContent anchor={anchor}>
						<ComboboxEmpty>No items found.</ComboboxEmpty>
						<ComboboxList>
							{(item) => (
								<ComboboxItem key={item} value={item}>
									{item}
								</ComboboxItem>
							)}
						</ComboboxList>
					</ComboboxContent>
				</Combobox>
			</FieldGroup>
			<FieldError id={id + '-error'} errors={fieldMessages(fieldState.error).map((message) => ({ message }))} />
		</FieldSet>
	);
}
function ChoiceSelect({
	control,
	name,
	label,
	options,
	disabled,
}: Props & {
	name: FieldPathByValue<PreferencesDraft, string>;
	label: string;
	options: readonly string[];
}) {
	const {
		field: { ref: inputRef, ...field },
		fieldState,
	} = useController({ control, name });
	const id = useId();
	return (
		<Field data-invalid={!!fieldState.error}>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			<Select
				disabled={disabled}
				name={field.name}
				value={field.value || null}
				onValueChange={(value) => field.onChange(value ?? '')}
				items={options.map((value) => ({ value, label: labels[value] ?? value }))}
			>
				<SelectTrigger
					id={id}
					ref={inputRef}
					onBlur={field.onBlur}
					aria-invalid={!!fieldState.error}
					aria-describedby={id + '-error'}
				>
					<SelectValue placeholder="Choose an option" />
				</SelectTrigger>
				<SelectContent>
					<SelectGroup>
						{options.map((option) => (
							<SelectItem key={option} value={option}>
								{labels[option] ?? option}
							</SelectItem>
						))}
					</SelectGroup>
				</SelectContent>
			</Select>
			<FieldError id={id + '-error'} errors={fieldMessages(fieldState.error).map((message) => ({ message }))} />
		</Field>
	);
}
export function PreferencesFields({ control, disabled }: Props) {
	const salaries = useFieldArray({ control, name: 'targetPosition.salaryRange' });
	const getSalaryFieldLabel = (row: (typeof salaries.fields)[number]) => labels[row.contractType] ?? 'New Salary';
	return (
		<FieldGroup>
			<FieldSection title="Target roles">
				<FieldGroup className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
					<ListField control={control} name="targetPosition.positionTitles" label="Position titles" />
					<ChoiceGroup
						disabled={disabled}
						control={control}
						name="targetPosition.seniority"
						label="Seniority"
						options={seniorities}
					/>
					<ChoiceGroup
						disabled={disabled}
						control={control}
						name="targetPosition.positionType"
						label="Position types"
						options={positionTypes}
					/>
				</FieldGroup>
			</FieldSection>
			<FieldSection title="Residence and work arrangements">
				<FieldGroup className="grid sm:grid-cols-2">
					<ChoiceGroup
						disabled={disabled}
						control={control}
						className="col-span-3"
						name="targetPosition.workArrangements"
						label="Acceptable work arrangements"
						options={workArrangements}
					/>
					<TextField
						control={control}
						name="targetPosition.location.city"
						label="Residence city"
						help="City where you live. It is required for hybrid or on-site work"
					/>
					<TextField
						control={control}
						name="targetPosition.location.country"
						label="Residence country"
						help="Country where you live. It is required for hybrid or on-site work"
					/>
				</FieldGroup>
			</FieldSection>
			<FieldSection title="Compensation">
				<FieldGroup>
					<FieldDescription>
						No salary entries means no compensation restriction. Baseline is the minimum acceptable pay;
						target is desired pay and never an upper cutoff.
					</FieldDescription>
					{salaries.fields.map((row, index) => (
						<FieldSet key={row.id}>
							<FieldLegend variant="label" className="flex items-center gap-2 w-full">
								<p>{getSalaryFieldLabel(row)}</p>
								<Button type="button" variant="destructive" onClick={() => salaries.remove(index)}>
									<Trash />
								</Button>
							</FieldLegend>
							<FieldGroup className="grid gap-4 sm:grid-cols-2">
								<ChoiceSelect
									disabled={disabled}
									control={control}
									name={`targetPosition.salaryRange.${index}.contractType`}
									label="Contract type"
									options={contractTypes}
								/>
								<ChoiceSelect
									disabled={disabled}
									control={control}
									name={`targetPosition.salaryRange.${index}.currency`}
									label="Currency"
									options={currencies}
								/>
								<ChoiceSelect
									disabled={disabled}
									control={control}
									name={`targetPosition.salaryRange.${index}.period`}
									label="Pay period"
									options={payPeriods}
								/>
								<TextField
									control={control}
									name={`targetPosition.salaryRange.${index}.min`}
									label="Baseline salary"
									inputMode="decimal"
								/>
								<TextField
									control={control}
									name={`targetPosition.salaryRange.${index}.desired`}
									label="Target salary (optional)"
									inputMode="decimal"
								/>
							</FieldGroup>
						</FieldSet>
					))}
					<Button
						type="button"
						variant="outline"
						className="w-fit ml-auto"
						disabled={salaries.fields.length >= 100}
						onClick={() => salaries.append({ ...emptySalary })}
					>
						Add salary
					</Button>
				</FieldGroup>
			</FieldSection>
			<FieldSection title="Skill matching">
				<TextField
					control={control}
					name="settings.minSkillMatch"
					label="Minimum skill match (%, optional)"
					inputMode="numeric"
					help="Enter 1–100 for the share of required skills you must have. Leave empty to skip skill matching. Add skills to your profile before using a threshold."
				/>
			</FieldSection>
			<FieldSection title="Search limits">
				<FieldGroup className="grid gap-4 sm:grid-cols-2">
					<TextField
						control={control}
						name="settings.maxJobsToProcess"
						label="Maximum vacancies to inspect"
						inputMode="numeric"
						help="Cannot exceed the inspection limit. A search may return fewer qualifying results."
					/>
					<TextField
						control={control}
						name="settings.maxJobsToMatch"
						label="Desired qualifying results for one search"
						inputMode="numeric"
						help="Desired results cannot exceed the inspection limit."
					/>
				</FieldGroup>
			</FieldSection>
		</FieldGroup>
	);
}
