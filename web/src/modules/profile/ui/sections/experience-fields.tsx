'use client';
import type { Control } from 'react-hook-form';
import type { FormValues } from '../../model/form-model';
import { FieldGroup, FieldSet, FieldLegend, FieldDescription } from '@/shared/components/ui/field';
import { TextField, ListField } from '@/shared/components/form/controls';
import { useFieldArray } from 'react-hook-form';
import { Button } from '@/shared/components/ui/button';
import { newExperience } from '../../model/form-model';
import { Separator } from '@/shared/components/ui/separator';
import { Trash } from 'lucide-react';

export function ExperienceFields({ control }: { control: Control<FormValues> }) {
	const { fields, append, remove } = useFieldArray({ control, name: 'experience' });
	const getExperienceItemLabel = (row: (typeof fields)[number]) =>
		row.company ? `${row.company} - ${row.role}` : `New Experience`;
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
						<TextField control={control} name={`experience.${index}.company`} label="Company" />
						<TextField control={control} name={`experience.${index}.role`} label="Role" />
						<TextField
							control={control}
							name={`experience.${index}.startDate`}
							label="Start date"
							help="Use YYYY, YYYY-MM or YYYY-MM-DD"
						/>
						<TextField
							control={control}
							name={`experience.${index}.endDate`}
							label="End date"
							help="Use YYYY, YYYY-MM or YYYY-MM-DD. May also be 'present'"
						/>
						<ListField control={control} name={`experience.${index}.achievements`} label="Achievements" />
						<ListField control={control} name={`experience.${index}.technologies`} label="Technologies" />
						<TextField
							control={control}
							name={`experience.${index}.description`}
							label="Description"
							multiline
						/>
					</FieldGroup>
					{index < fields.length - 1 ? <Separator /> : null}
				</FieldSet>
			))}
			<Button type="button" className="w-fit ml-auto" variant="outline" onClick={() => append(newExperience())}>
				Add experience
			</Button>
		</FieldSet>
	);
}
