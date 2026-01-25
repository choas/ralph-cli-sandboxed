# Skills Configuration

Skills are reusable instruction sets that extend Claude's behavior for specific languages, frameworks, or project requirements. They inject additional context and rules into the prompt sent to Claude during each iteration.

## Overview

Skills help enforce best practices, prevent common mistakes, and provide domain-specific guidance. For example, a Swift skill might prevent naming files `main.swift` when using the `@main` attribute.

## Configuration

Skills are configured in `.ralph/config.json` under the `claude.skills` array:

```json
{
  "claude": {
    "skills": [
      {
        "name": "skill-name",
        "description": "Brief description of what the skill does",
        "instructions": "Detailed instructions injected into Claude's prompt",
        "userInvocable": false
      }
    ]
  }
}
```

## Skill Definition

Each skill has the following fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Unique identifier for the skill. Use kebab-case (e.g., `swift-main-naming`). |
| `description` | string | Yes | Brief human-readable description shown during selection. |
| `instructions` | string | Yes | Full instructions injected into Claude's prompt. Can include examples, rules, and formatting. |
| `userInvocable` | boolean | No | If `true`, user can invoke the skill via `/skill-name`. Defaults to `true`. |

### Field Details

#### name

The skill name should be:
- Unique within the project
- Descriptive of its purpose
- Use kebab-case (lowercase with hyphens)

Examples: `swift-main-naming`, `react-hooks-rules`, `go-error-handling`

#### description

A concise one-line description that:
- Explains what the skill does
- Helps users understand when to use it
- Is shown during `ralph init` skill selection

#### instructions

The detailed instructions that Claude receives. Best practices:
- Start with a clear statement of the rule or guidance
- Explain the "why" so Claude understands the reasoning
- Include concrete examples of correct and incorrect patterns
- Use code blocks for examples
- Keep instructions focused on a single concern

Example:
```
IMPORTANT: In Swift, files containing the @main attribute MUST NOT be named main.swift.

When the @main attribute is used, Swift automatically generates an entry point.
If the file is also named main.swift, Swift treats it as having a manual entry point,
causing a conflict.

RULES:
- Never name a file main.swift if it contains @main attribute
- Use descriptive names like App.swift or the actual type name

BAD:
// main.swift
@main struct App { ... }

GOOD:
// App.swift
@main struct App { ... }
```

#### userInvocable

Controls whether the skill can be invoked on-demand:
- `true` (default): User can trigger the skill with `/skill-name`
- `false`: Skill is always active but cannot be explicitly invoked

Set to `false` for skills that should always be active (like language-specific rules).

## Built-in Skills

Ralph includes built-in skills for specific languages in `src/config/skills.json`. During `ralph init`, you can select which skills to enable for your project.

### Currently Available Skills

**Common Skills** (applied to all languages):

| Skill Name | Description |
|------------|-------------|
| `sandbox-safe` | Prevents starting dev servers in sandboxed environments |

**Language-Specific Skills**:

| Language | Skill Name | Description |
|----------|------------|-------------|
| Swift | `swift-main-naming` | Prevents naming files main.swift when using @main attribute |

## Adding Skills During Init

When running `ralph init`, you'll be prompted to select skills for your chosen language:

```bash
ralph init

# ... language selection ...

? Select skills for Swift (optional):
  ◉ swift-main-naming - Prevents naming files main.swift when using @main attribute
```

Selected skills are automatically added to your `.ralph/config.json`.

## Custom Skills

You can add custom skills directly to your config file:

```json
{
  "claude": {
    "skills": [
      {
        "name": "project-conventions",
        "description": "Project-specific coding conventions",
        "instructions": "Follow these project conventions:\n\n1. Use camelCase for variables\n2. Use PascalCase for types\n3. All public functions must have documentation comments\n4. Error messages must include error codes in format ERR-XXX",
        "userInvocable": false
      },
      {
        "name": "review-checklist",
        "description": "Code review checklist",
        "instructions": "Before committing, verify:\n- [ ] All tests pass\n- [ ] No console.log statements\n- [ ] No TODO comments without issue links\n- [ ] Public APIs are documented",
        "userInvocable": true
      }
    ]
  }
}
```

## Skill Scopes

Skills can be scoped for different purposes:

### Language-Specific Skills
Target common pitfalls or best practices for a language:
- Naming conventions
- Common anti-patterns
- Language-specific idioms

### Framework Skills
Target framework-specific patterns:
- React hooks rules
- Express middleware patterns
- Django model conventions

### Project Skills
Target project-specific requirements:
- Code style guides
- Architecture decisions
- Team conventions

## How Skills Are Applied

When ralph runs an iteration:

1. Skills from `claude.skills` are loaded from config
2. Skill instructions are injected into the prompt template
3. Claude receives the combined prompt with all active skill instructions

This ensures Claude consistently follows your defined rules across all iterations.

## Troubleshooting

### Skill not appearing in selection

- Ensure the skill is defined in `src/config/skills.json` under the correct language key
- Verify the JSON syntax is valid

### Skill instructions not being followed

- Check that the skill is listed in `.ralph/config.json` under `claude.skills`
- Ensure the instructions are clear and specific
- Add concrete examples of correct/incorrect patterns

### Conflicting skills

If two skills have conflicting instructions:
- Review and consolidate the instructions
- Remove the less important skill
- Adjust instructions to handle edge cases explicitly
