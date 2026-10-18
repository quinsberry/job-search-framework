import { z } from 'zod';

export const profileIdentitySchema = z.object({
    fullName: z.string().min(1, 'First name is required'),
    location: z.string().min(1, 'Location is required'),
    email: z.email('Invalid email address'),
    phone: z.string().optional(),
    links: z.array(z.url('Invalid URL')).optional(),
    summary: z.string().optional(),
});

export const experienceSchema = z.array(
    z.object({
        company: z.string().min(1, 'Company name is required'),
        role: z.string().min(1, 'Role is required'),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        achievements: z.string().optional(),
        technologies: z.string().optional(),
        description: z.string().optional(),
    }),
);

export const skillsSchema = z.array(z.string().min(1, 'Skill name is required'));

export const educationSchema = z.array(
    z.object({
        institution: z.string().min(1, 'Institution name is required'),
        degree: z.string().min(1, 'Degree is required'),
        fieldOfStudy: z.string().min(1, 'Field of study is required'),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
    }),
);

export const languageProficienciesSchema = z.array(
    z.object({
        language: z.string().min(1, 'Language is required'),
        proficiency: z.enum(['B1', 'B2', 'C1', 'Native']).optional(),
    }),
);

export const certificationSchema = z.array(
    z.object({
        name: z.string().min(1, 'Certification name is required'),
        issuingOrganization: z.string().min(1, 'Issuing organization is required'),
        issueDate: z.string().optional(),
        expirationDate: z.string().optional(),
        credentialId: z.string().optional(),
        credentialUrl: z.url('Invalid URL').optional(),
    }),
);

export const profileSchema = z.object({
    identity: profileIdentitySchema,
    experience: experienceSchema,
    skills: skillsSchema,
    education: educationSchema,
    certifications: certificationSchema.optional(),
    languages: languageProficienciesSchema,
});

export type CandidateProfile = z.infer<typeof profileSchema>;
