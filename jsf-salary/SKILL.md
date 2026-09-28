---
name: jsf-salary
description: Research a defensible salary range to tell a recruiter for a software vacancy, using the company, role, job seeker's residence, and optional vacancy description. Show the range in PLN, USD, and EUR.
---

# JSF Salary

Help the job seeker state an ambitious, defensible **fixed-cash asking range** for a specific vacancy. Never present a salary as guaranteed or claim a precise probability of acceptance.

## Inputs

Get the company name, vacancy title, and the job seeker's residence location (city and country if available). Accept a vacancy description or link when provided. A vacancy link is useful but not required.

Resolve missing facts before pricing:

- Research whether this vacancy is for the company's own product or for client work/outstaffing. If the company does both or the model is unclear, inspect the vacancy description. If none is available, ask for it; if it still does not settle the model, ask which model to assume.
- Find the role's level and scope from the title, description, or public posting. Ask the user if seniority remains unclear.
- Find the contract type in the posting or description. If it remains unclear, ask whether to price employment or contractor/B2B. Do not mix their pay figures.

## Research and estimate

Read [references/salary-evidence.md](references/salary-evidence.md). Research current compensation evidence **for each request**; stored examples and old estimates are not current market data.

Use the residence market to select comparisons, including for remote work. Match role, level, contract type, and company model as closely as the evidence permits. Treat product versus outsource/outstaff as a comparability factor, not a fixed percentage adjustment. Give the employer's current published band priority when it applies to this location and contract. If that band is below the broader market, keep the recommended asking range inside it and flag the gap.

Build an asking range in the upper but defensible part of the applicable evidence. Explain the main comparisons and adjustments; do not invent a statistical percentile or an unsupported number. If evidence is thin, give a **provisional** range with low confidence and identify the gaps. If live research is unavailable, say so instead of claiming a current market estimate. Cite direct source links and observation dates.

Quote fixed cash only. State whether the figures are gross/pre-tax employment pay or a contractor rate before VAT, and use the pay period customary for the residence market. Discuss bonus, equity, and benefits separately if relevant. Do not silently compare total compensation with base pay or net pay with gross pay.

## Currency and answer

State the asking range first in the market's native currency, then show the **same range** in PLN, USD, and EUR for display. Converting a foreign salary does not create a local salary benchmark. Use a current, dated exchange-rate source. For currencies covered by the ECB, `python3 scripts/convert_fx.py LOW HIGH CURRENCY` converts both endpoints using its latest published reference rates. For other currencies, find a reliable dated rate and show the calculation. Round displayed ranges to sensible salary increments so conversions do not imply false precision.

End with a short sentence the user could say to HR using the native-currency range and pay basis. Include confidence, the key evidence, and any assumptions or data gaps.
