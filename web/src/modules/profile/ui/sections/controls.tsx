'use client';
import { useController, type Control, type FieldPathByValue } from 'react-hook-form';
import type { FormValues } from '../../model/form-model';
import { fieldMessages } from '../../model/editor-state';
import { Field, FieldLabel, FieldError, FieldDescription } from '@/shared/components/ui/field';
import { Input } from '@/shared/components/ui/input';
import { Textarea } from '@/shared/components/ui/textarea';

type Props<T> = { control: Control<FormValues>; name: FieldPathByValue<FormValues, T>; label?: string; help?: string };
export function TextField({
	control,
	name,
	label,
	help,
	multiline,
	className,
}: Props<string> & { multiline?: boolean; className?: string }) {
	const { field, fieldState } = useController({ control, name });
	const id = 'profile-' + name.replaceAll('.', '-');
	const Control = multiline ? Textarea : Input;
	return (
		<Field data-invalid={!!fieldState.error} className={className}>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			<Control
				{...field}
				id={id}
				aria-invalid={!!fieldState.error}
				aria-describedby={id + '-help ' + id + '-error'}
			/>
			<FieldDescription id={id + '-help'}>{help}</FieldDescription>
			<FieldError id={id + '-error'} errors={fieldMessages(fieldState.error).map((message) => ({ message }))} />
		</Field>
	);
}
export function ListField({ control, name, label }: Props<string[]>) {
	const { field, fieldState } = useController({ control, name });
	const id = 'profile-' + name.replaceAll('.', '-');
	return (
		<Field data-invalid={!!fieldState.error}>
			{label && <FieldLabel htmlFor={id}>{label}</FieldLabel>}
			<Textarea
				{...field}
				id={id}
				value={field.value.join('\n')}
				onChange={(event) => field.onChange(event.target.value.split('\n'))}
				onBlur={() => {
					field.onChange(field.value.map((value) => value.trim()).filter(Boolean));
					field.onBlur();
				}}
				aria-invalid={!!fieldState.error}
				aria-describedby={id + '-help ' + id + '-error'}
			/>
			<FieldDescription id={id + '-help'}>
				One item per line. Add or remove lines to change this list.
			</FieldDescription>
			<FieldError id={id + '-error'} errors={fieldMessages(fieldState.error).map((message) => ({ message }))} />
		</Field>
	);
}
