---
application: dev-studio
applicationKind: service
module: Design
title: "Dev Studio — faces & data model (working visualization)"
status: Draft
owner: "Tuncho"
scope: "A working visual of Dev Studio's phases (faces), the design-document lifecycle, the testing model, and the Supabase test-data schema. Rendered so the diagrams can be reviewed. Decisions G1/G4 and the store choice (A/B/C) are still open."
---

# Dev Studio — faces & data model (working visualization)

Status: **Working draft — for visual review.** Not the finalized design doc.
Three decisions are still open and are noted at the bottom.

## 1. The faces, end to end

```mermaid
flowchart TD
  subgraph DESIGN["DESIGN TAB — low-trust agent (docs + Notion only)"]
    A["Open project (new / existing)"] --> B["Project-level conversation"]
    B --> C{"Agent detects<br/>module-specific intent?"}
    C -->|no| B
    C -->|yes| D["Shift focus to that module"]
    D --> E["DESIGN DOCUMENT<br/>diagrams · actors · rules · edge cases · test intents"]
    E --> F{"Status gate"}
    F -->|in progress / refine| E
    F -->|confirmed| G["IMPLEMENTATION PLAN<br/>derived from the design doc"]
  end

  G --> N1["NOTION — machine contract<br/>tasks · depends_on · status · pr_url · Q&A"]

  subgraph REVIEW["REVIEW / EXECUTION TAB — high-trust agent (repo creds, PRs)"]
    N1 --> H["Refine implementation plan (optional dialogue)"]
    H --> I["Coding agent runs ONE task → PR"]
    I --> J["App reads back: code generated? PR open / merged?"]
    J --> K["Run tests: generic + precision (typed or Excel)"]
    K --> L{"Build · typecheck · tests pass?"}
    L -->|no| H
    L -->|yes| M["Owner merges · unblock dependents"]
  end
```

## 2. The design-document lifecycle

```mermaid
stateDiagram-v2
  [*] --> Started
  Started --> InProgress: begin authoring
  InProgress --> Confirmed: owner approves
  InProgress --> Archived: shelve
  Confirmed --> InProgress: reopen for changes
  Confirmed --> Executed: all derived tasks merged
  Executed --> Archived: retire
  Started --> Deleted
  InProgress --> Deleted
  Confirmed --> Deleted
  Deleted --> [*]
  Archived --> [*]
```

## 3. The testing model

```mermaid
flowchart TD
  DD["Design doc: rules + edge cases"] --> TM["Test matrix (DERIVED from edge cases)"]
  TM --> GEN["GENERIC tests<br/>structural — does the flow run, return 200, not throw"]
  TM --> PREC["PRECISION tests<br/>specific input → KNOWN expected outcome"]
  PREC --> EX["e.g. credit-card payment"]
  EX --> S1["valid number + valid date + valid CVV → approved"]
  EX --> S2["valid number + expired date → declined"]
  EX --> S3["valid number + valid date + wrong CVV → declined"]
  PREC --> SRC{"Data source"}
  SRC -->|type values| MAN["Manual entry in the UI"]
  SRC -->|upload| XLS["Excel → rows of inputs + expected outcome"]
  GEN --> RUN["Executor runs as a pre-merge gate"]
  PREC --> RUN
  RUN --> RES["Per-row: actual vs expected → pass / fail"]
  RES --> N["Reflected in Notion + Review tab"]
```

## 4. Supabase — the test-data schema

The tables in bold are **test_scenario**, **test_case**, **test_run**,
**test_result**. They are the only relational data Dev Studio needs; Notion
is bad at hundreds of tabular rows, so the test data lives in Postgres.

```mermaid
erDiagram
  test_scenario ||--o{ test_case : "has"
  test_run ||--o{ test_result : "produces"
  test_case ||--o{ test_result : "evaluated as"

  test_scenario {
    uuid id PK
    text module "design-doc / module ref"
    text name
    text kind "generic | precision"
    text description
  }
  test_case {
    uuid id PK
    uuid scenario_id FK
    jsonb inputs
    text expected_outcome
    text source "manual | excel"
  }
  test_run {
    uuid id PK
    text task_id "→ Notion task (soft, cross-system)"
    text pr_url
    timestamptz started_at
    text status
  }
  test_result {
    uuid id PK
    uuid run_id FK
    uuid test_case_id FK
    text actual
    boolean pass
  }
```

## Open decisions (block finalizing the design)

- **G1 — design doc vs implementation plan:** separate linked documents
  (recommended) or one document with two sections?
- **G4 — testing:** a gate the Executor must pass before opening/merging a PR
  (recommended), or a separate QA face triggered after code exists?
- **Store choice:** A (Notion board + Supabase for test data — recommended),
  B (Supabase system-of-record, Notion synced view), or C (drop Notion, Dev
  Studio's own board on Supabase)?
