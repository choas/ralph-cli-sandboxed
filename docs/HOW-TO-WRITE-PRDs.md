# Writing Effective PRDs for Ralph

This guide explains how to write Product Requirement Documents (PRDs) that Ralph's AI agent can understand and execute effectively.

## PRD Structure

Each PRD item is a JSON object with four fields:

```json
{
  "category": "feature",
  "description": "Short imperative description of what to implement",
  "steps": [
    "First concrete action to take",
    "Second concrete action to take",
    "Verification step to confirm completion"
  ],
  "passes": false
}
```

## Categories

Use consistent categories to organize your PRD:

| Category | Use for |
|----------|---------|
| `setup` | Initial project configuration, build verification |
| `feature` | New functionality |
| `bugfix` | Fixing broken behavior |
| `refactor` | Code improvements without behavior change |
| `docs` | Documentation updates |
| `release` | Version bumps, changelog updates |
| `config` | Configuration file changes |
| `test` | Adding or updating tests |

## Writing Good Descriptions

The description should be a **single sentence** that clearly states what needs to be done.

### Do
- Start with an **imperative verb** (Add, Implement, Fix, Update, Remove)
- Be specific about **what** and **where**
- Include context if needed in parentheses

### Don't
- Use vague language ("improve", "enhance", "handle")
- Write multiple sentences
- Include implementation details (save those for steps)

### Examples

| Bad | Good |
|-----|------|
| "version flag" | "Implement --version flag that displays CLI name and version" |
| "fix the bug with containers" | "Fix --dangerously-skip-permissions flag not being set in container environment" |
| "add a pamatere to prd to clean" | "Add `ralph prd clean` command to remove completed items" |
| "make docker better" | "Ensure Docker builds always pull latest Claude Code version" |

## Writing Good Steps

Steps tell the AI agent exactly **how** to verify or implement the requirement.

### Guidelines

1. **Be concrete**: Specify exact commands, file paths, and expected outputs
2. **Use backticks** for commands: \`npm run build\`
3. **One action per step**: Don't combine multiple actions
4. **Include verification**: End with a step that confirms success
5. **Order matters**: Steps should be executable in sequence

### Step Patterns

**For features:**
```json
"steps": [
  "Implement X in src/path/file.ts",
  "Add Y functionality that does Z",
  "Run `command` and confirm expected output"
]
```

**For bug fixes:**
```json
"steps": [
  "Identify the cause of X in src/path/file.ts",
  "Fix by doing Y",
  "Run `command` and verify the bug is resolved"
]
```

**For documentation:**
```json
"steps": [
  "Add section 'X' to README.md",
  "Include explanation of Y",
  "Include example showing Z"
]
```

**For releases:**
```json
"steps": [
  "Update version in package.json to 'X.Y.Z'",
  "Run `npm run build` to verify no errors",
  "Run `command --version` and confirm it shows X.Y.Z"
]
```

## Anti-Patterns to Avoid

### Vague Steps
```json
// Bad
"steps": [
  "Make it work",
  "Test it",
  "Verify it's good"
]

// Good
"steps": [
  "Add error handling for null input in parseConfig()",
  "Run `npm test` and confirm all tests pass",
  "Run `ralph init` with missing config and verify helpful error message"
]
```

### Steps That Require Human Judgment
```json
// Bad
"steps": [
  "Understand the codebase",
  "Decide the best approach",
  "Implement your solution"
]

// Good
"steps": [
  "Add retry logic with exponential backoff to fetchData() in src/api.ts",
  "Set max retries to 3 with initial delay of 1000ms",
  "Run `npm test` and verify retry tests pass"
]
```

### Missing Verification
```json
// Bad
"steps": [
  "Update the version number"
]

// Good
"steps": [
  "Update version in package.json to '1.2.3'",
  "Run `npm run build` to verify no errors",
  "Run `ralph --version` and confirm output shows '1.2.3'"
]
```

## Priority Through Ordering

Ralph processes PRD items from top to bottom. Place higher-priority items first in the array.

Recommended ordering:
1. Setup/infrastructure items
2. Bug fixes (blocking issues)
3. Core features
4. Enhancement features
5. Documentation
6. Release items

## Granularity

Break large features into smaller, independently completable items. Each item should be achievable in a single Ralph iteration.

```json
// Too large
{
  "description": "Implement user authentication system",
  "steps": ["Add login, logout, registration, password reset, OAuth..."]
}

// Better: Split into multiple items
{
  "description": "Add user registration endpoint POST /api/register",
  "steps": [...]
},
{
  "description": "Add user login endpoint POST /api/login",
  "steps": [...]
},
{
  "description": "Add JWT token generation and validation",
  "steps": [...]
}
```

## Quick Reference

```json
{
  "category": "feature|bugfix|docs|release|setup|refactor|config|test",
  "description": "Imperative verb + specific what + where (context)",
  "steps": [
    "Concrete action with `commands` and file paths",
    "Another specific action",
    "Verification: Run `command` and confirm expected result"
  ],
  "passes": false
}
```
