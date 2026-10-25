// Values the job seeker chooses from; source contracts add their own `unknown` where a source may not say.
export const contractTypes = ['permanent', 'B2B'] as const;
export const currencies = ['USD', 'EUR', 'PLN'] as const;
export const payPeriods = ['annual', 'month', 'hourly'] as const;
export const workArrangements = ['remote', 'on-site', 'hybrid'] as const;
