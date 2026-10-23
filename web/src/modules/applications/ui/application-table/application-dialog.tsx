'use client';
import { useId, useMemo } from 'react';
import { useController, useForm, type Control, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { TextField } from '@/shared/components/form/controls';
import { Button } from '@/shared/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/shared/components/ui/dialog';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/shared/components/ui/field';
import { type ApplicationChanges } from '../../model/contracts';
import { applicationFormSchema, formDefaults, type ApplicationForm } from './application-form';
import { ResolutionFields } from './resolution-fields';
import type { ApplicationRow } from './rows';
import { OptionSelect, statusOptions } from './status-select';

export type DialogTarget = ApplicationRow | 'new' | null;

export function ApplicationDialog({
	target,
	busy,
	error,
	onClose,
	onSubmit,
}: {
	target: DialogTarget;
	busy: boolean;
	error: string | null;
	onClose: () => void;
	onSubmit: (values: ApplicationChanges) => void;
}) {
	return (
		<Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
			<DialogContent className="sm:max-w-lg">
				{target ? (
					<ApplicationFormBody
						key={target === 'new' ? 'new' : target.id}
						target={target}
						busy={busy}
						error={error}
						onClose={onClose}
						onSubmit={onSubmit}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function ApplicationFormBody({
	target,
	busy,
	error,
	onClose,
	onSubmit,
}: {
	target: ApplicationRow | 'new';
	busy: boolean;
	error: string | null;
	onClose: () => void;
	onSubmit: (values: ApplicationChanges) => void;
}) {
	const row = target === 'new' ? null : target;
	const facts = row === null || row.origin === 'manual';
	const resolver = useMemo(
		() => zodResolver(applicationFormSchema(row?.origin ?? 'new')) as unknown as Resolver<ApplicationForm>,
		[row],
	);
	const form = useForm<ApplicationForm>({ defaultValues: formDefaults(row), resolver });
	return (
		<form
			noValidate
			onSubmit={(event) => void form.handleSubmit((values) => onSubmit(values as ApplicationChanges))(event)}
		>
			<DialogHeader>
				<DialogTitle>{row ? 'Edit application' : 'Add application'}</DialogTitle>
				<DialogDescription>
					{row
						? row.origin === 'search'
							? `${row.title}${row.company ? ` at ${row.company}` : ''}. Correct the work arrangement or update your expected salary.`
							: 'Update the vacancy you added.'
						: 'Track a vacancy you found elsewhere. It is not matched against your preferences.'}
				</DialogDescription>
			</DialogHeader>
			<fieldset disabled={busy} className="min-w-0">
				<FieldGroup className="max-h-[60vh] overflow-y-auto py-4">
					{facts ? (
						<>
							<TextField control={form.control} name="url" label="Link to the posting" />
							<TextField control={form.control} name="title" label="Title" />
							<TextField control={form.control} name="company" label="Company" />
							<TextField
								control={form.control}
								name="location"
								label="Location"
								help="City first, e.g. Warsaw, Poland"
							/>
							<TextField control={form.control} name="salary" label="Advertised salary" />
						</>
					) : null}
					<StatusField control={form.control} />
					<ResolutionFields form={form} search={row?.origin === 'search'} />
				</FieldGroup>
			</fieldset>
			{error ? (
				<p role="alert" className="pb-3 text-sm text-destructive">
					{error}
				</p>
			) : null}
			<DialogFooter>
				<Button type="button" variant="outline" onClick={onClose}>
					Cancel
				</Button>
				<Button type="submit" isInProgress={busy}>
					{row ? 'Save changes' : 'Add application'}
				</Button>
			</DialogFooter>
		</form>
	);
}

function StatusField({ control }: { control: Control<ApplicationForm> }) {
	const { field, fieldState } = useController({ control, name: 'status' });
	const id = useId();
	return (
		<Field data-invalid={!!fieldState.error}>
			<FieldLabel htmlFor={id}>Status</FieldLabel>
			<OptionSelect
				id={id}
				label="Status"
				value={field.value}
				options={statusOptions}
				onChange={field.onChange}
			/>
			<FieldError errors={fieldState.error ? [{ message: fieldState.error.message }] : []} />
		</Field>
	);
}
