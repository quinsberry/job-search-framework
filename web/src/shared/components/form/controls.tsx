'use client';
import { useId } from 'react';
import { useController, type Control, type FieldPathByValue, type FieldValues } from 'react-hook-form';
import { fieldMessages } from '@/shared/lib/field-messages';
import { Field, FieldLabel, FieldError, FieldDescription } from '@/shared/components/ui/field';
import { Input } from '@/shared/components/ui/input';
import { Textarea } from '@/shared/components/ui/textarea';

type Props<F extends FieldValues, V> = {
	control: Control<F>;
	name: FieldPathByValue<F, V>;
	label?: string;
	help?: string;
};
export function TextField<F extends FieldValues>({
	control,
	name,
	label,
	help,
	multiline,
	className,
	inputMode,
}: Props<F, string | undefined> & {
	multiline?: boolean;
	className?: string;
	inputMode?: 'decimal' | 'numeric';
}) {
	const { field, fieldState } = useController({ control, name });
	const id = useId();
	const InputControl = multiline ? Textarea : Input;
	return (
		<Field data-invalid={!!fieldState.error} className={className}>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			<InputControl
				{...field}
				value={String(field.value ?? '')}
				id={id}
				inputMode={inputMode}
				aria-invalid={!!fieldState.error}
				aria-describedby={`${id}-help ${id}-error`}
			/>
			<FieldDescription id={id + '-help'}>{help}</FieldDescription>
			<FieldError id={id + '-error'} errors={fieldMessages(fieldState.error).map((message) => ({ message }))} />
		</Field>
	);
}
export function ListField<F extends FieldValues>({ control, name, label }: Props<F, string[]>) {
	const { field, fieldState } = useController({ control, name });
	const id = useId();
	const values = field.value as string[];
	return (
		<Field data-invalid={!!fieldState.error}>
			{label && <FieldLabel htmlFor={id}>{label}</FieldLabel>}
			<Textarea
				{...field}
				id={id}
				value={values.join('\n')}
				onChange={(event) => field.onChange(event.target.value.split('\n'))}
				onBlur={() => {
					field.onChange(values.map((value) => value.trim()).filter(Boolean));
					field.onBlur();
				}}
				aria-invalid={!!fieldState.error}
				aria-describedby={`${id}-help ${id}-error`}
			/>
			<FieldDescription id={id + '-help'}>
				One item per line. Add or remove lines to change this list.
			</FieldDescription>
			<FieldError id={id + '-error'} errors={fieldMessages(fieldState.error).map((message) => ({ message }))} />
		</Field>
	);
}
