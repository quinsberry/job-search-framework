'use client';
import type { Control } from 'react-hook-form';
import type { FormValues } from '../model/form-model';
import { FieldGroup } from '@/shared/components/ui/field';
import { IdentityFields } from './sections/identity-fields';
import { ExperienceFields } from './sections/experience-fields';
import { SkillsFields } from './sections/skills-fields';
import { EducationFields } from './sections/education-fields';
import { CertificationFields } from './sections/certification-fields';
import { LanguageFields } from './sections/language-fields';
import { FieldSection } from '@/shared/components/form/field-section';

export default function ProfileFields({ control }: { control: Control<FormValues> }) {
	return (
		<FieldGroup>
			<FieldSection title="Identity">
				<IdentityFields control={control} />
			</FieldSection>
			<FieldSection title="Experience">
				<ExperienceFields control={control} />
			</FieldSection>
			<FieldSection title="Skills">
				<SkillsFields control={control} />
			</FieldSection>
			<FieldSection title="Education">
				<EducationFields control={control} />
			</FieldSection>
			<FieldSection title="Certifications">
				<CertificationFields control={control} />
			</FieldSection>
			<FieldSection title="Languages">
				<LanguageFields control={control} />
			</FieldSection>
		</FieldGroup>
	);
}
