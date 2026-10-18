'use client';
import type { Control } from 'react-hook-form';
import type { FormValues } from '../../model/form-model';
import { FieldSet } from '@/shared/components/ui/field';
import { ListField } from '@/shared/components/form/controls';
export function SkillsFields({ control }: { control: Control<FormValues> }) {
	return (
		<FieldSet>
			<ListField control={control} name="skills" />
		</FieldSet>
	);
}
