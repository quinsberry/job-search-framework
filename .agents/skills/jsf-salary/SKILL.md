---
name: jsf-salary
description: Research a defensible salary range to tell a recruiter for a software vacancy, preferably from its URL, or from the company, role details, and job seeker's residence. Show the range in PLN, USD, and EUR.
---

# JSF Salary

Invoke this skill directly with vacancy details and residence; no workflow or workspace initialization is required. The original `scripts/convert_fx.py` CLI remains stable. Python integrations use `jsf_salary.convert_fx` from this skill's `scripts` directory; there are no sibling-skill runtime dependencies. Live research and exchange-rate access remain external inputs.

Help the job seeker state an ambitious, defensible **fixed-cash asking range** for a specific vacancy. Never present a salary as guaranteed or claim a precise probability of acceptance.

## Inputs

Prefer the vacancy URL as input. If invoked without vacancy information, immediately ask: "Please provide the vacancy URL, or provide the vacancy details: company, title, full description (duties and requirements), and your residence (city and country)." Do not start research before this first response. The URL is optional; users who do not have or want to share it can provide the details instead.

When given a URL, read the vacancy page and extract the company, title, duties, requirements, and any stated contract type or pay band. Then ask only for required facts still missing, especially the job seeker's residence. If the page is inaccessible or lacks the duties and requirements needed to assess role scope, ask the user to paste the missing vacancy details and wait. If the URL and user-provided details conflict about the role or requirements, ask which vacancy information to use before pricing. For a partial request without a URL, find the public posting when possible and ask for missing facts. Do not estimate from the title alone; a usable vacancy description and residence location are required.

Resolve missing facts before pricing:

- Classify the vacancy from the actual work arrangement: **Product** for work on the hiring company's own product, **Outsource** for client work delivered as a project by the provider, or **Outstaff** for a developer supplied to and working within a client's team. Use the vacancy, not the company's overall business model. If the description does not settle the type, research the posting and company; if it remains unclear, ask the user which type to assume.
- Determine role scope and level primarily from the description's duties, required skills, and required knowledge. Treat the title as a secondary clue. If they conflict, price the described scope and explain the mismatch. Distinguish required qualifications from preferences. Ask the user if scope or seniority remains unclear after reading the description.
- Find the contract type in the posting or description. Price only the offered type when it is explicit. When both employment and contractor arrangements are offered, or the type remains unspecified, calculate separate asking ranges for both without asking the user to choose. Use UoP and B2B labels in Poland; elsewhere use the local employment and contractor equivalents. Never blend their pay figures.

## Research and estimate

Read [references/salary-evidence.md](references/salary-evidence.md). Research current compensation evidence **for each request**; stored examples and old estimates are not current market data.

Use the residence market to select comparisons, including for remote work. Match the described duties, required skills and knowledge, scope, level, contract type, and vacancy type as closely as the evidence permits; do not base the estimate mainly on the title or add unsupported premiums for skill keywords. Treat vacancy type as a comparability factor, not a fixed percentage adjustment. Before setting a range, check for compensation reported by employees in the hiring company's residence-market office and comparable role or level (for example, individual Levels.fyi submissions); record the pay component, date, level, experience, and sample size when available. Give the employer's current published band priority when it applies to this location and contract. If that band is below the broader market, keep the recommended asking range inside it and flag the gap. When pricing both contract types, assess each against evidence for that type separately.

Build an asking range in the upper but defensible part of the applicable evidence. Reconcile employer-specific local reports with broader-market comparisons before recommending a range: explain a material gap, and do not present a market-level ask as likely to fit that employer without evidence. A single employee report is not a hiring band; consider its age, role match, and pay components before letting it determine the range. Explain the main comparisons and adjustments; do not invent a statistical percentile or an unsupported number. If evidence is thin, give a **provisional** range with low confidence and identify the gaps. If live research is unavailable, say so instead of claiming a current market estimate. Cite direct source links and observation dates.

Quote fixed cash only. State whether the figures are gross/pre-tax employment pay or a contractor rate before VAT, and use the pay period customary for the residence market. Discuss bonus, equity, and benefits separately if relevant. Do not silently compare total compensation with base pay or net pay with gross pay.

## Currency and answer

State each asking range first in the market's native currency, then show the **same range** in PLN, USD, and EUR for display. Converting a foreign salary does not create a local salary benchmark. Use a current, dated exchange-rate source. For currencies covered by the ECB, `python3 scripts/convert_fx.py LOW HIGH CURRENCY` converts both endpoints using its latest published reference rates. For other currencies, find a reliable dated rate and show the calculation. Round displayed ranges to sensible salary increments so conversions do not imply false precision.

Include a standalone line in the result exactly as `vacancy type - <vacancy_type>`, replacing `<vacancy_type>` with **Outsource**, **Outstaff**, or **Product**.

End with a short sentence the user could say to HR using the native-currency range and pay basis; provide one sentence per contract type when showing both. Include confidence, the key evidence, and any assumptions or data gaps.
