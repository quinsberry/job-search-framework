# Job Search Framework

The framework helps a job seeker find vacancies that fit their profile and search preferences.

## Language

**Candidate profile**:
The candidate's source-backed professional facts: identity, experience, skills, education, certifications and languages. It is distinct from search preferences and vacancy-specific application materials.
_Avoid_: tailored CV, search criteria

**Draft**:
Unpublished edits to the candidate profile or search configuration, retained for recovery. It becomes active only when the job seeker explicitly saves it; an unfinished draft does not invalidate the saved version.

**Search criteria**:
The job seeker's requirements and preferences used to discover and assess vacancies, including role, compensation and location eligibility.

**Search configuration**:
The job seeker's editable choices for a vacancy search. It can be edited without a saved candidate profile or AI connection; past experience alone does not establish desired roles or mandatory vacancy requirements. Residence means where the candidate lives; it does not by itself establish an acceptable commute or remote-country eligibility.

**Baseline salary**:
The minimum acceptable compensation in a search preference, expressed with a contract type, currency and pay period.

**Target salary**:
The desired compensation in a search preference, at least its baseline salary when supplied. It is not an upper cutoff for acceptable vacancy pay.

**Contract type**:
The legal and commercial arrangement under which the job seeker would be paid, such as permanent employment or B2B.

**Work location arrangement**:
Whether a vacancy requires remote, hybrid or on-site work. It is distinct from the contract type.
_Avoid_: contract type

**Qualifying vacancy**:
A vacancy with evidence satisfying every mandatory search criterion and no confirmed exclusion. Qualifying vacancies count toward the requested vacancy count.
_Avoid_: inspected listing, possible match

**Vacancy needing clarification**:
A vacancy with missing or ambiguous evidence for at least one mandatory search criterion and no confirmed disqualifying condition.
_Avoid_: qualifying vacancy, confirmed match

**Skill match**:
The share of a vacancy's must-have skills the candidate has, compared to the job seeker's chosen threshold. Nice-to-have skills do not count toward this share.

**Match outcome**:
The result of evaluating vacancy evidence against the candidate's criteria: match, no-match or needs-clarification. Failures to evaluate are errors rather than match outcomes.

**Decision model**:
The AI model that answers the matching questions structured checks cannot settle. Changing it changes how vacancies are judged.

**Application**:
A row in the job seeker's application list: a vacancy whose match outcome is match or needs-clarification, or one the job seeker added by hand. Being an application does not mean the job seeker has applied; its application status says that.
_Avoid_: lead, result

**Application status**:
Where the job seeker stands with an application: new (found, not applied yet), applied, interviewing, offer, rejected (by the employer) or dismissed (by the job seeker).

**Search memory**:
The search workflow's record of every inspected vacancy, accepted ones included. Deleting an application does not touch it; the application list remembers deletions itself, so the search never finds a deleted application again.

**Inspected vacancy**:
A vacancy the search workflow has already evaluated, identified by its company, title and place rather than by one publisher's ID, and kept in search memory. Rejected vacancies are evaluated again after the search criteria, the matching rules or the decision model change, or after 60 days; accepted ones never are. An inspected vacancy is not necessarily a qualifying vacancy.

**Advertised compensation**:
The employer's published fixed-cash pay amount or range for a vacancy, with its contract type, currency, pay period and original text. A vacancy may advertise several. It is distinct from the candidate's baseline and target salary and from an employer offer.

**Discovery query**:
A plain-text request for vacancy discovery, optionally constrained by workplace location, acceptable work arrangements and publication cutoff. These discovery hints do not establish that a vacancy satisfies the candidate's search criteria.

**Search source**:
A vacancy publisher from which listings and details are acquired. Its source-owned vacancy identity remains distinct from the identity of a hiring opening appearing across publishers.

**Acquisition run**:
One bounded effort to acquire vacancy evidence from explicitly selected sources for a discovery query. Continuation observes a changing publisher, rather than a frozen snapshot.

**Vacancy availability**:
The observed open, closed or unknown state of a posting. Missing closure evidence and failed acquisition do not establish that a vacancy is open or closed.

**Duplicate vacancy**:
Another appearance of the same hiring opening, including appearances in different sources or search runs. Similar company names and titles alone do not establish that two listings describe the same opening.

**Discovery budget**:
The limit on search effort used to find qualifying vacancies. It is separate from the requested count of qualifying vacancies.
