'use client';
import type { Control } from 'react-hook-form';
import type { FormValues } from '../../model/form-model';
import { FieldGroup, FieldSet, FieldLegend, FieldDescription } from '@/shared/components/ui/field';
import { TextField } from './controls';
import { useFieldArray } from 'react-hook-form';
import { Button } from '@/shared/components/ui/button';
import { newCertification } from '../../model/form-model';
import { Trash } from 'lucide-react';
import { Separator } from '@/shared/components/ui/separator';
export function CertificationFields({ control }: { control: Control<FormValues> }) {
	const { fields, append, remove } = useFieldArray({ control, name: 'certifications' });
	const getExperienceItemLabel = (row: (typeof fields)[number]) => {
		return row.name ? `${row.name} - ${row.issuingOrganization}` : `New Certification`;
	};
	return (
		<FieldSet>
			{fields.length === 0 ? <FieldDescription>No entries. Add one if applicable.</FieldDescription> : null}
			{fields.map((row, index) => (
				<FieldSet key={row.id}>
					<FieldLegend variant="label" className="flex items-center gap-2 w-full">
						<p>{getExperienceItemLabel(row)}</p>
						<Button type="button" variant="destructive" onClick={() => remove(index)}>
							<Trash />
						</Button>
					</FieldLegend>
					<FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<TextField control={control} name={`certifications.${index}.name`} label="Name" />
						<TextField
							control={control}
							name={`certifications.${index}.issuingOrganization`}
							label="Issuing organization"
						/>
						<TextField
							control={control}
							name={`certifications.${index}.issueDate`}
							label="Issue date"
							help="Use YYYY, YYYY-MM or YYYY-MM-DD"
						/>
						<TextField
							control={control}
							name={`certifications.${index}.expirationDate`}
							label="Expiration date"
							help="Use YYYY, YYYY-MM or YYYY-MM-DD"
						/>
						<TextField
							control={control}
							name={`certifications.${index}.credentialId`}
							label="Credential ID"
						/>
						<TextField
							control={control}
							name={`certifications.${index}.credentialUrl`}
							label="Credential URL"
						/>
					</FieldGroup>
					{index < fields.length - 1 ? <Separator /> : null}
				</FieldSet>
			))}
			<Button
				type="button"
				variant="outline"
				className="w-fit ml-auto"
				onClick={() => append(newCertification())}
			>
				Add certification
			</Button>
		</FieldSet>
	);
}
