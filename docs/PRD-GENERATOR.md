# PRD Generator Guide

This guide explains how to convert any document (specs, user stories, detailed PRDs) into a `prd.json` file that Ralph can execute.

## Overview

Ralph's PRD format is intentionally simple - each item should be completable in a single AI iteration. The challenge is converting complex, multi-level documents into this flat, actionable format.

```json
{
  "category": "feature",
  "description": "Imperative description of what to implement",
  "steps": [
    "Concrete action 1",
    "Concrete action 2",
    "Verification step"
  ],
  "passes": false
}
```

## Input Document Types

### 1. Detailed Technical PRDs (like lazymcp-prd.md)

Structure: Phases > Tasks > Sub-tasks with code examples

**Conversion Strategy:**
- Each **sub-task** becomes one PRD item
- Reference the original document for code examples
- Preserve ordering (phases execute in sequence)

### 2. User Stories / Epics

Structure: "As a user, I want X so that Y"

**Conversion Strategy:**
- Break each story into implementation steps
- Each step that produces working code = one PRD item
- Add acceptance criteria as verification steps

### 3. Feature Specifications

Structure: Requirements, constraints, acceptance criteria

**Conversion Strategy:**
- Group related requirements into implementable chunks
- Each chunk = one PRD item
- Convert acceptance criteria to verification steps

### 4. Bug Reports

Structure: Description, reproduction steps, expected behavior

**Conversion Strategy:**
- Usually one bug = one PRD item
- Steps: investigate, fix, verify
- Include reproduction test in verification

## Granularity Guidelines

The right granularity is: **"What can an AI complete in one iteration?"**

### Too Large (Split It)
- "Implement authentication system" - has multiple components
- "Build the UI" - too vague, many parts
- "Add database support" - schema, queries, migrations are separate

### Too Small (Combine It)
- "Add import statement" - trivial
- "Create empty file" - no value alone
- "Update one variable name" - part of a larger change

### Just Right
- "Implement login endpoint with JWT token generation"
- "Create user registration form with validation"
- "Add password reset email functionality"

### Rule of Thumb
If a task has 3+ distinct sub-parts that each require thought, split it.
If a task takes 2 minutes without thinking, combine with related work.

## Category Selection

| Category | When to Use |
|----------|-------------|
| `setup` | Project initialization, tooling, dependencies |
| `feature` | New functionality for users |
| `bugfix` | Fixing broken behavior |
| `refactor` | Code improvements, no behavior change |
| `docs` | Documentation (README, guides, comments) |
| `test` | Test coverage (unit, integration, e2e) |
| `release` | Version bumps, changelogs, packaging |
| `config` | Configuration files, settings |
| `integration` | Connecting components, wiring, orchestration |

## Writing Descriptions

### Format
```
[Imperative verb] [specific what] [where/context] (Reference)
```

### Examples

| Source Text | PRD Description |
|-------------|-----------------|
| "The system should authenticate users" | "Implement user authentication with JWT tokens" |
| "Task 2.3.1: Message Display" | "Create chat message display view (Task 2.3.1)" |
| "Bug: Login fails on Safari" | "Fix login failure on Safari browser" |
| "We need better error handling" | "Add error boundary component to catch React errors" |

### Do
- Start with imperative verb (Implement, Create, Add, Fix, Update)
- Be specific about location (file, component, endpoint)
- Include task reference if converting from structured PRD

### Don't
- Use passive voice ("should be implemented")
- Be vague ("improve the system")
- Include implementation details (save for steps)

## Writing Steps

Steps tell the AI **how** to implement and **how** to verify.

### Step Types

1. **Action Steps** - What to do
   ```
   "Create internal/auth/jwt.go with JWT token functions"
   "Add login endpoint POST /api/auth/login in routes.go"
   ```

2. **Reference Steps** - Where to find details
   ```
   "Follow the implementation pattern in spec.md section 3.2"
   "Use the schema defined in docs/api.yaml"
   ```

3. **Verification Steps** - How to confirm success
   ```
   "Run `go test ./internal/auth/...` and verify all tests pass"
   "Start server and confirm POST /api/auth/login returns 200"
   ```

### Step Patterns by Category

**Feature:**
```json
"steps": [
  "Create [file/component] with [functionality]",
  "Implement [specific behavior]",
  "Run [test/build command] and verify success"
]
```

**Bugfix:**
```json
"steps": [
  "Identify root cause of [bug] in [location]",
  "Fix by [specific change]",
  "Add test case for regression, run tests"
]
```

**Setup:**
```json
"steps": [
  "Run [init/install command]",
  "Configure [settings] in [file]",
  "Verify with [check command]"
]
```

## Referencing External Documents

When your source document has code examples or detailed specs, reference them instead of copying:

### Good
```json
{
  "description": "Implement WebSocket transport (Task 4.4.1)",
  "steps": [
    "Create internal/mcp/transport/websocket.go with WebSocketTransport struct",
    "Follow implementation pattern in lazymcp-prd.md section 4.4.1",
    "Run `go build ./...` and verify compilation"
  ]
}
```

### Why Reference?
- Keeps prd.json concise
- Source document has full context
- AI can read referenced doc for details
- Avoids sync issues if source changes

### Reference Format
- `"See [document] section [X.Y.Z]"`
- `"Follow pattern in [document] [section name]"`
- `"Use schema from [document]"`

## Conversion Examples

### Example 1: Technical PRD Sub-task

**Source (lazymcp-prd.md):**
```markdown
#### Sub-task 4.2.1: Process Management
- Initialize subprocess with exec.Command
- Setup stdin/stdout/stderr pipes
- Handle environment variables from config
```

**Converted:**
```json
{
  "category": "feature",
  "description": "Implement stdio transport process management (Task 4.2.1)",
  "steps": [
    "Create internal/mcp/transport/stdio.go with StdioTransport struct",
    "Manage subprocess with exec.Command, setup stdin/stdout/stderr pipes",
    "See lazymcp-prd.md section 4.2.1 for implementation details"
  ],
  "passes": false
}
```

### Example 2: User Story

**Source:**
```
As a user, I want to reset my password via email so I can regain access to my account.

Acceptance criteria:
- User can request reset with email address
- Email contains secure reset link (expires in 1 hour)
- User can set new password via reset link
```

**Converted (3 items):**
```json
{
  "category": "feature",
  "description": "Add password reset request endpoint POST /api/auth/reset-request",
  "steps": [
    "Create endpoint that accepts email address",
    "Generate secure token, store with expiry (1 hour)",
    "Queue email with reset link containing token"
  ],
  "passes": false
},
{
  "category": "feature",
  "description": "Implement password reset email sending",
  "steps": [
    "Create email template with reset link",
    "Integrate with email service (SendGrid/SES)",
    "Test email delivery in development"
  ],
  "passes": false
},
{
  "category": "feature",
  "description": "Add password reset completion endpoint POST /api/auth/reset-complete",
  "steps": [
    "Validate token exists and not expired",
    "Update user password with new value",
    "Invalidate token, return success response"
  ],
  "passes": false
}
```

### Example 3: Bug Report

**Source:**
```
Bug: App crashes when user uploads file > 10MB
Steps to reproduce:
1. Go to upload page
2. Select file larger than 10MB
3. Click upload
4. App crashes with "heap out of memory"
```

**Converted:**
```json
{
  "category": "bugfix",
  "description": "Fix crash when uploading files larger than 10MB",
  "steps": [
    "Add file size validation before upload (max 10MB with clear error)",
    "Implement streaming upload for large files to avoid memory issues",
    "Test with 15MB file - should show error or stream successfully"
  ],
  "passes": false
}
```

## AI Conversion Prompt

Use this prompt to have an AI convert documents to prd.json:

```
Convert the following document into a Ralph prd.json file.

Rules:
1. Each sub-task or atomic feature = one PRD item
2. Use categories: setup, feature, bugfix, refactor, docs, test, release, config, integration
3. Descriptions: imperative verb + specific what + context
4. Steps: 2-4 concrete actions + verification step
5. Reference source document sections instead of copying code
6. Order items by logical execution sequence
7. Set all "passes": false

Output format:
[
  {
    "category": "...",
    "description": "...",
    "steps": ["...", "...", "..."],
    "passes": false
  }
]

Document to convert:
---
[paste document here]
---
```

## Validation Checklist

After generating prd.json, verify:

- [ ] Each item is completable in one AI iteration
- [ ] Descriptions start with imperative verbs
- [ ] Steps are concrete and verifiable
- [ ] Items are ordered by dependency/sequence
- [ ] Categories are consistent
- [ ] References to source docs are accurate
- [ ] No duplicate or overlapping items

## Tips for Large Documents

1. **Process in phases** - Convert one section at a time
2. **Number your references** - "(Task 1.2.3)" helps navigation
3. **Group related items** - Keep dependent items adjacent
4. **Start with setup** - Infrastructure items first
5. **End with docs/release** - Documentation and packaging last

## Common Mistakes

| Mistake | Problem | Fix |
|---------|---------|-----|
| Copy-pasting code into steps | JSON too large, hard to read | Reference source document |
| Vague descriptions | AI doesn't know what to do | Be specific about what and where |
| Missing verification | No way to confirm completion | Add test/build/check step |
| Too many steps | Overwhelming, hard to track | Max 4-5 steps per item |
| Wrong granularity | Items too big or too small | One iteration = one item |
