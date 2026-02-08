# MCP Server

Ralph includes a [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that exposes PRD management tools to any MCP-compatible client. This allows AI assistants like Claude to read, update, and track your PRD directly through tool calls.

## Overview

The MCP server runs over **stdio** transport and provides four tools:

| Tool | Description |
|------|-------------|
| `ralph_prd_list` | List PRD entries with optional filters |
| `ralph_prd_add` | Add a new PRD entry |
| `ralph_prd_status` | Get completion status and breakdown |
| `ralph_prd_toggle` | Toggle pass/fail status for entries |

## Installation

The MCP server is included with ralph. Install ralph globally or use npx:

```bash
npm install -g ralph-cli-sandboxed
```

The server binary is available as `ralph-mcp` after installation.

## MCP Client Configuration

### Claude Code

Add the following to your project's `.mcp.json` file (or `~/.claude/mcp.json` for global access):

```json
{
  "mcpServers": {
    "ralph": {
      "command": "ralph-mcp",
      "args": []
    }
  }
}
```

If ralph is installed locally (not globally), use npx:

```json
{
  "mcpServers": {
    "ralph": {
      "command": "npx",
      "args": ["ralph-cli-sandboxed", "--mcp"]
    }
  }
}
```

### Other MCP Clients

Any MCP client that supports stdio transport can connect to the ralph MCP server. Point your client at the `ralph-mcp` binary with no arguments.

## Available Tools

### ralph_prd_list

List PRD entries with optional category and status filters.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `category` | enum | No | Filter by category: `ui`, `feature`, `bugfix`, `setup`, `development`, `testing`, `docs` |
| `status` | enum | No | Filter by status: `all` (default), `passing`, `failing` |

**Returns:** JSON array of entries, each containing:

```json
[
  {
    "category": "feature",
    "description": "Add user authentication",
    "steps": ["Create login form", "Implement JWT tokens"],
    "passes": false,
    "index": 1
  }
]
```

**Examples:**
- List all entries: `ralph_prd_list({})`
- List failing features: `ralph_prd_list({ category: "feature", status: "failing" })`
- List passing entries: `ralph_prd_list({ status: "passing" })`

### ralph_prd_add

Add a new PRD entry with category, description, and verification steps.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `category` | enum | Yes | Category: `ui`, `feature`, `bugfix`, `setup`, `development`, `testing`, `docs` |
| `description` | string | Yes | Description of the requirement |
| `steps` | string[] | Yes | Non-empty array of verification steps |
| `branch` | string | No | Git branch associated with this entry |

**Returns:** JSON with confirmation message and the added entry including its 1-based index.

```json
{
  "message": "Added entry #3: \"Add dark mode support\"",
  "entry": {
    "category": "feature",
    "description": "Add dark mode support",
    "steps": ["Add theme toggle", "Implement dark CSS variables"],
    "passes": false,
    "index": 3
  }
}
```

### ralph_prd_status

Get PRD completion status with counts, percentage, per-category breakdown, and remaining items. Takes no parameters.

**Returns:**

```json
{
  "passing": 5,
  "total": 8,
  "percentage": 63,
  "categories": {
    "feature": { "passing": 3, "total": 5 },
    "setup": { "passing": 2, "total": 2 },
    "docs": { "passing": 0, "total": 1 }
  },
  "remaining": [
    { "index": 3, "category": "feature", "description": "Add search functionality" },
    { "index": 6, "category": "feature", "description": "Add notifications" },
    { "index": 8, "category": "docs", "description": "Write API documentation" }
  ]
}
```

### ralph_prd_toggle

Toggle the completion status (`passes`) for one or more PRD entries by their 1-based index.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `indices` | number[] | Yes | 1-based indices of PRD entries to toggle |

**Returns:** JSON with confirmation and list of toggled entries.

```json
{
  "message": "Toggled 2 entry/entries",
  "toggled": [
    { "index": 1, "description": "Add login page", "passes": true },
    { "index": 3, "description": "Add search", "passes": false }
  ]
}
```

Out-of-range indices return an error. Duplicate indices are deduplicated before toggling.

## Example Conversations

### Checking project progress

> **User:** What's the status of our PRD?
>
> **Assistant:** *(calls `ralph_prd_status`)* Your PRD is 63% complete (5 of 8 tasks passing). You have 3 remaining items: search functionality, notifications, and API documentation.

### Adding a new requirement

> **User:** We need to add internationalization support.
>
> **Assistant:** *(calls `ralph_prd_add` with category "feature", description "Add internationalization (i18n) support", steps ["Install i18n library", "Extract user-facing strings", "Add language switcher"])* Done! Added as entry #9 in the feature category.

### Marking work as complete

> **User:** I've finished the search functionality (item 3).
>
> **Assistant:** *(calls `ralph_prd_toggle` with indices [3])* Toggled entry #3 "Add search functionality" to passing.

### Filtering the PRD

> **User:** Show me all the incomplete feature tasks.
>
> **Assistant:** *(calls `ralph_prd_list` with category "feature", status "failing")* You have 2 incomplete feature tasks: notifications (#6) and i18n support (#9).
