'use client';
import type { Control } from 'react-hook-form';
import type { FormValues } from '../../model/form-model';
import { Field, FieldGroup, FieldSet, FieldDescription, FieldError } from '@/shared/components/ui/field';
import { TextField } from '@/shared/components/form/controls';
import { Controller, useFieldArray } from 'react-hook-form';
import { Button } from '@/shared/components/ui/button';
import { newLanguage } from '../../model/form-model';
import { proficiencyLevels } from '../../model/schema';
import { Trash } from 'lucide-react';
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/shared/components/ui/select';

const items = proficiencyLevels.map((value) => ({ value, label: value || 'Unknown' }));
export function LanguageFields({ control }: { control: Control<FormValues> }) {
	const { fields, append, remove } = useFieldArray({ control, name: 'languages' });
	return (
		<FieldSet>
			{fields.length === 0 ? <FieldDescription>No entries. Add one if applicable.</FieldDescription> : null}
			{fields.map((row, index) => (
				<FieldSet key={row.id}>
					<FieldGroup className="flex flex-row items-center gap-4">
						<TextField control={control} name={`languages.${index}.language`} className="w-fit" />
						<Controller
							control={control}
							name={`languages.${index}.proficiency`}
							render={({ field, fieldState }) => {
								const id = `profile-languages-${index}-proficiency`;
								return (
									<Field data-invalid={!!fieldState.error} className="w-fit">
										<Select
											name={field.name}
											items={items}
											value={field.value}
											onValueChange={(value) => {
												if (value !== null) field.onChange(value);
											}}
										>
											<SelectTrigger
												id={id}
												ref={field.ref}
												onBlur={field.onBlur}
												aria-invalid={!!fieldState.error}
												aria-describedby={id + '-error'}
											>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectGroup>
													{items.map((item) => (
														<SelectItem key={item.value} value={item.value}>
															{item.label}
														</SelectItem>
													))}
												</SelectGroup>
											</SelectContent>
										</Select>
										<FieldError id={id + '-error'} errors={[fieldState.error]} />
									</Field>
								);
							}}
						/>
						<Button type="button" variant="destructive" onClick={() => remove(index)}>
							<Trash />
						</Button>
					</FieldGroup>
				</FieldSet>
			))}
			<Button type="button" variant="outline" className="w-fit ml-auto" onClick={() => append(newLanguage())}>
				Add language
			</Button>
		</FieldSet>
	);
}
