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
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';

export default function ProfileFields({ control }: { control: Control<FormValues> }) {
	return (
		<FieldGroup>
			<ProfileField title="Identity">
				<IdentityFields control={control} />
			</ProfileField>
			<ProfileField title="Experience">
				<ExperienceFields control={control} />
			</ProfileField>
			<ProfileField title="Skills">
				<SkillsFields control={control} />
			</ProfileField>
			<ProfileField title="Education">
				<EducationFields control={control} />
			</ProfileField>
			<ProfileField title="Certifications">
				<CertificationFields control={control} />
			</ProfileField>
			<ProfileField title="Languages">
				<LanguageFields control={control} />
			</ProfileField>
		</FieldGroup>
	);
}
interface ProfileFieldProps {
	title: string;
	children: React.ReactNode;
}
export function ProfileField({ title, children }: ProfileFieldProps) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>{title}</CardTitle>
			</CardHeader>
			<CardContent>{children}</CardContent>
		</Card>
	);
}
