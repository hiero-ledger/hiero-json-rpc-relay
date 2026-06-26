---
name: generate-adr
description: "Generate a decision record from a Spectra change for sharing with colleagues before implementation"
license: MIT
compatibility: Requires spectra CLI.
metadata:
  author: user
  version: "1.0"
---

Generate an Architecture Decision Record (ADR) from a completed Spectra change proposal. The ADR is written to `openspec/changes/<name>/adr.md` and formatted for pasting into Notion or a similar tool for team review before implementation begins.

**Input**: The argument after `/spectra-adr` is the change name. If omitted, list available changes and ask.

**Prerequisites**: The change MUST have a completed `proposal.md`. A `design.md` is recommended but not required. Run `/spectra-propose` first if artifacts are missing.

---

## Steps

### 1. Resolve the change name

If a change name was provided as an argument, use it. Otherwise:

```bash
spectra list --json
```

If exactly one change exists, use it. If multiple exist, show the list and ask the user which to use.

### 2. Read change artifacts

```bash
spectra show <name> --json
```

Read all available artifacts for the change:
- `openspec/changes/<name>/proposal.md` (required)
- `openspec/changes/<name>/design.md` (if present)
- `openspec/changes/<name>/specs/**/*.md` (if present)
- `openspec/changes/<name>/tasks.md` (if present)

If `proposal.md` is missing, stop and tell the user to run `/spectra-propose <name>` first.

### 3. Classify the proposal type

Read the proposal to determine if it is a **Feature**, **Bug Fix**, or **Enhancement/Refactor** based on its section headings (`## Why` / `## Problem` / `## Summary`).

### 4. Generate the ADR

Write the ADR using the template below. Fill every section from the change artifacts — no placeholders.

**Title**: Derive from the change name (convert kebab-case to Title Case, strip leading issue numbers).
Example: `5086-conformity-test-synthetic-txns` → `Conformity Tests: Synthetic Transaction Coverage`

**Status**: Always `Proposed` for a freshly generated ADR.

**Date**: Use today's date in `YYYY-MM-DD` format.

---

#### ADR Template

```markdown
# ADR: <Title>

**Status**: Proposed
**Date**: <YYYY-MM-DD>
**Change**: `<change-name>`

---

## Context

<!-- From proposal Why/Summary/Problem — 2-4 sentences on the problem and why it matters now -->

## Options Considered

<!-- From design.md Decisions/Alternatives. If design.md is absent, derive from proposal Non-Goals. -->
<!-- For each option: name, description, pros, cons. Use a table. -->

### Option A: <name>

<description>

| Pros | Cons |
|------|------|
| ... | ... |

### Option B: <name>

<description>

| Pros | Cons |
|------|------|
| ... | ... |

<!-- Add more options if the design covers them -->

## Decision

<!-- The option that was chosen, stated as a clear sentence. Derive from design Decisions sections or proposal Proposed Solution. -->

## Rationale

<!-- WHY this option was chosen over the others. Derive from design decision rationale paragraphs. 3-5 bullet points. -->

- ...

## Consequences

<!-- Trade-offs, risks, and known limitations. Derive from design Risks/Trade-offs section. -->

### Positive

- ...

### Negative / Risks

- ...

## Implementation Scope

<!-- High-level summary of what will change. Derive from proposal Impact and tasks.md groups.
     Do NOT paste the full task list — summarize in 4-6 bullet points. -->

- ...

## Open Questions

<!-- Any unresolved decisions or unknowns from design.md Open Questions, or things not yet decided.
     Leave empty and omit this section if there are none. -->

- ...
```

---

### 5. Write the ADR file

Write the generated ADR to:

```
openspec/changes/<name>/adr.md
```

Then print the full ADR content to the conversation so the user can copy it directly into Notion.

### 6. Show copy hint

After printing, show:

```
Saved to openspec/changes/<name>/adr.md
Copy the content above into Notion for team review.
When the team has approved, run /spectra-apply <name> to begin implementation.
```

---

## Quality Rules

- **No placeholders**: Every section must be filled. If source material is thin, write short but concrete content — never "TBD" or "See proposal".
- **Plain language**: The ADR audience is the broader team, not just engineers. Avoid internal jargon without explanation.
- **Options table**: Always present at least two options. If the proposal/design only shows one chosen approach, reconstruct the rejected alternatives from the Non-Goals section.
- **Decision sentence**: Must be a single concrete sentence starting with "We will…" or "The team will…".
- **Consequences split**: Separate positive from negative. Don't merge them.
- **Implementation scope**: 4-6 bullets maximum. It's a summary, not a task list.
