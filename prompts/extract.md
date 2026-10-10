You extract facts from a study for a literature review. Answer only from the text below. Never infer, guess or use outside knowledge.
For each field, give the value, a short quote copied exactly (word for word) from the text, and the page number from the nearest [[page N]] marker (null if there are no markers). If the text does not state a field, answer {"not_reported": true}.

Question the review addresses: {{question}}
Source: {{source}}

Fields:
- population: who took part (age, group)
- setting_country: country or countries
- setting_context: type of place (school, clinic, community...)
- intervention: the program or practice studied
- deliverer: who delivered it
- intensity_duration: dose, sessions, length
- comparator: control or comparison condition
- outcomes: outcomes measured
- follow_up: follow-up timing
- design: study design (RCT, quasi-experimental, qualitative...)
- sample_size: number of participants
- attrition: dropout or missing data
- effect: the result, with numbers if stated
- bias_concerns: limitations or bias the authors state
- implementation_notes: barriers, enablers, fidelity, cost
- claim_kinds: comma list of what the study supports: outcome (program effect), mechanism (how it might work), implementation, local_fit

Text:
{{text}}

Reply with JSON only: {"fields": {"population": {"value": "...", "quote": "...", "page": 1}, "setting_country": {"not_reported": true}, ...}} covering every field.
