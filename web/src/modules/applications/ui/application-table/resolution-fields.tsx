'use client';
import { useId } from 'react';
import { useController, useWatch, type UseFormReturn } from 'react-hook-form';
import { contractTypes, currencies, payPeriods } from '@/shared/compensation';
import { workArrangementSchema } from '@/shared/search-sources/contracts';
import { TextField } from '@/shared/components/form/controls';
import { Button } from '@/shared/components/ui/button';
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from '@/shared/components/ui/field';
import { ToggleGroup, ToggleGroupItem } from '@/shared/components/ui/toggle-group';
import { fieldMessages } from '@/shared/lib/field-messages';
import { OptionSelect } from './status-select';
import type { ApplicationForm } from './application-form';

type Form = UseFormReturn<ApplicationForm>;
const labels: Record<string, string> = {
	remote: 'Remote',
	hybrid: 'Hybrid',
	'on-site': 'On-site',
	permanent: 'Permanent employment',
	B2B: 'B2B',
	annual: 'Annual',
	month: 'Monthly',
	hourly: 'Hourly',
};

export function ResolutionFields({ form, search }: { form: Form; search: boolean }) {
	return (
		<>
			{search ? <ArrangementField form={form} /> : null}
			<ExpectedSalaryField form={form} />
		</>
	);
}

function ArrangementField({ form }: { form: Form }) {
	const { field, fieldState } = useController({ control: form.control, name: 'workArrangementOverride' });
	const id = useId();
	return (
		<FieldSet>
			<FieldLegend>Work arrangement</FieldLegend>
			<FieldDescription>
				{field.value === null
					? 'Using the original assessment. Select arrangements to resolve this criterion manually.'
					: 'Manual correction. Other criteria keep their original assessment.'}
			</FieldDescription>
			<ToggleGroup
				multiple
				variant="outline"
				aria-label="Work arrangement"
				aria-invalid={!!fieldState.error}
				aria-describedby={id}
				value={field.value ?? []}
				onValueChange={field.onChange}
			>
				{workArrangementSchema.options.map((value) => (
					<ToggleGroupItem key={value} value={value} type="button">
						{labels[value]}
					</ToggleGroupItem>
				))}
			</ToggleGroup>
			<Button
				type="button"
				variant="outline"
				size="sm"
				className="w-fit"
				disabled={field.value === null}
				onClick={() => field.onChange(null)}
			>
				Reset to original
			</Button>
			<FieldError id={id} errors={fieldMessages(fieldState.error).map((message) => ({ message }))} />
		</FieldSet>
	);
}

function ExpectedSalaryField({ form }: { form: Form }) {
	const salary = useWatch({ control: form.control, name: 'expectedSalary' });
	const error = form.formState.errors.expectedSalary;
	const replace = () =>
		form.setValue(
			'expectedSalary',
			{ amount: '', currency: '', period: '', contractType: '' },
			{ shouldDirty: true },
		);
	const clear = () => {
		form.setValue('expectedSalary', null, { shouldDirty: true });
		form.clearErrors('expectedSalary');
	};
	return (
		<FieldSet>
			<FieldLegend>Expected salary</FieldLegend>
			<FieldDescription>
				What you plan to ask for. A compatible amount meeting your saved minimum resolves salary for a search
				result; it does not change employer pay.
			</FieldDescription>
			{salary !== null && typeof salary === 'object' ? (
				<FieldGroup className="grid gap-3 sm:grid-cols-2">
					<TextField control={form.control} name="expectedSalary.amount" label="Amount" inputMode="decimal" />
					<SalaryChoice form={form} name="expectedSalary.currency" label="Currency" options={currencies} />
					<SalaryChoice form={form} name="expectedSalary.period" label="Pay period" options={payPeriods} />
					<SalaryChoice
						form={form}
						name="expectedSalary.contractType"
						label="Contract type"
						options={contractTypes}
					/>
				</FieldGroup>
			) : typeof salary === 'string' ? (
				<>
					<p className="text-sm">Saved text: {salary}</p>
					<FieldDescription>
						This text is preserved until replaced or cleared. It does not resolve salary automatically.
					</FieldDescription>
					<Button type="button" variant="outline" className="w-fit" onClick={replace}>
						Replace with structured salary
					</Button>
				</>
			) : (
				<Button type="button" variant="outline" className="w-fit" onClick={replace}>
					Set expected salary
				</Button>
			)}
			{salary !== null ? (
				<Button type="button" variant="outline" size="sm" className="w-fit" onClick={clear}>
					Clear expected salary
				</Button>
			) : null}
			{salary === null || typeof salary === 'string' ? (
				<FieldError errors={fieldMessages(error).map((message) => ({ message }))} />
			) : null}
		</FieldSet>
	);
}

function SalaryChoice({
	form,
	name,
	label,
	options,
}: {
	form: Form;
	name: 'expectedSalary.currency' | 'expectedSalary.period' | 'expectedSalary.contractType';
	label: string;
	options: readonly string[];
}) {
	const { field, fieldState } = useController({ control: form.control, name });
	const id = useId();
	return (
		<Field data-invalid={!!fieldState.error}>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			<OptionSelect
				id={id}
				label={label}
				value={field.value ?? ''}
				options={options.map((value) => ({ value, label: labels[value] ?? value }))}
				onChange={field.onChange}
				invalid={!!fieldState.error}
			/>
			<FieldError errors={fieldMessages(fieldState.error).map((message) => ({ message }))} />
		</Field>
	);
}
