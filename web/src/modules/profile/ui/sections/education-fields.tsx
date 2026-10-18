'use client';
import type { Control } from 'react-hook-form';
import type { FormValues } from '../../model/form-model';
import { FieldGroup, FieldSet, FieldLegend, FieldDescription } from '@/shared/components/ui/field';
import { TextField } from '@/shared/components/form/controls';
import { useFieldArray } from 'react-hook-form';
import { Button } from '@/shared/components/ui/button';
import { newEducation } from '../../model/form-model';
import { Trash } from 'lucide-react';
import { Separator } from '@/shared/components/ui/separator';
export function EducationFields({ control }: { control: Control<FormValues> }) {
	const { fields, append, remove } = useFieldArray({ control, name: 'education' });
	const getEducationItemLabel = (row: (typeof fields)[number]) =>
		row.fieldOfStudy ? `${row.fieldOfStudy} (${row.degree})` : 'New Degree';
	return (
		<FieldSet>
			{fields.length === 0 ? <FieldDescription>No entries. Add one if applicable.</FieldDescription> : null}
			{fields.map((row, index) => (
				<FieldSet key={row.id}>
					<FieldLegend variant="label" className="flex items-center gap-2 w-full">
						<p>{getEducationItemLabel(row)}</p>
						<Button type="button" variant="destructive" onClick={() => remove(index)}>
							<Trash />
						</Button>
					</FieldLegend>
					<FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
						<TextField control={control} name={`education.${index}.institution`} label="Institution" />
						<TextField control={control} name={`education.${index}.degree`} label="Degree" />
						<TextField control={control} name={`education.${index}.fieldOfStudy`} label="Field of study" />
						<TextField
							control={control}
							className="col-span-1 sm:col-span-1"
							name={`education.${index}.startDate`}
							label="Start date"
							help="Use YYYY, YYYY-MM or YYYY-MM-DD. End dates may also be present."
						/>
						<TextField
							control={control}
							className="col-span-1 sm:col-span-1"
							name={`education.${index}.endDate`}
							label="End date"
							help="Use YYYY, YYYY-MM or YYYY-MM-DD. End dates may also be present."
						/>
					</FieldGroup>
					{index < fields.length - 1 ? <Separator /> : null}
				</FieldSet>
			))}
			<Button type="button" variant="outline" className="w-fit ml-auto" onClick={() => append(newEducation())}>
				Add education
			</Button>
		</FieldSet>
	);
}
