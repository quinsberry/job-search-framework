'use client';
import type { Control } from 'react-hook-form';
import type { FormValues } from '../../model/form-model';
import { FieldGroup, FieldSet } from '@/shared/components/ui/field';
import { TextField, ListField } from './controls';
export function IdentityFields({ control }: { control: Control<FormValues> }) {
	return (
		<FieldSet>
			<FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">
				<TextField control={control} name="identity.fullName" label="Full name" />
				<TextField control={control} name="identity.location" label="Location" />
				<TextField control={control} name="identity.email" label="Email" />
				<TextField control={control} name="identity.phone" label="Phone" />
				<ListField control={control} name="identity.links" label="Links" />
				<TextField control={control} name="identity.summary" label="Summary" multiline />
			</FieldGroup>
		</FieldSet>
	);
}
