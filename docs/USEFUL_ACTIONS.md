# Useful Ralph Actions

This document lists useful actions that can be executed via `ralph action <name>` and their configuration for `.ralph/config.json`.

## Overview

Actions are predefined commands configured in `.ralph/config.json` that can be triggered from inside a Docker container to execute operations on the host machine. This is particularly useful for:

- Running host-only tools (Xcode, native compilers)
- Sending notifications
- Triggering deployments
- Logging and monitoring
- Integrating with external services

## Usage

```bash
ralph action <name> [args...]   # Execute an action
ralph action --list             # List available actions
ralph action --help             # Show help
```

---

## Built-in Actions

These actions are available by default without configuration:

| Action | Description | Requires Daemon | Availability |
|--------|-------------|-----------------|--------------|
| `ping` | Health check - responds with 'pong' | Yes | Always |
| `notify` | Send notification via configured provider | Yes | When `notifications.provider` is set |
| `telegram_notify` | Send notification via Telegram | Yes | When Telegram chat is configured |
| `slack_notify` | Send notification via Slack | Yes | When Slack chat is configured |
| `discord_notify` | Send notification via Discord | Yes | When Discord chat is configured |
| `chat_status` | Get PRD status as JSON | Yes | Always |
| `chat_add` | Add new task to PRD | Yes | Always |

> **Important**: All built-in actions require the daemon to be running (`ralph daemon start`). They use a message queue to communicate between the container and the host.

### Conditional Built-in Actions

Some built-in actions only appear when their corresponding provider is configured:

- **`notify`**: Requires `notifications.provider` to be set to `"ntfy"` or `"command"`
- **`telegram_notify`**: Requires `chat.telegram.botToken` to be set
- **`slack_notify`**: Requires `chat.slack.botToken`, `chat.slack.appToken`, and `chat.slack.signingSecret` to be set
- **`discord_notify`**: Requires `chat.discord.botToken` to be set

### Custom Actions vs Built-in Actions

When running `ralph action`:

- **Inside a container**: All actions (built-in and custom) are sent to the daemon via the message queue
- **Outside a container**:
  - Built-in actions still use the message queue (daemon required)
  - Custom actions execute directly on the host (no daemon required)

---

## Useful Custom Actions

### 1. Build & Test Actions

#### Run Build Script
Execute a custom build script on the host.

```json
{
  "daemon": {
    "actions": {
      "build": {
        "command": "./scripts/build.sh",
        "description": "Build the project"
      }
    }
  }
}
```

#### Run Tests with Coverage
Run tests and generate coverage reports.

```json
{
  "daemon": {
    "actions": {
      "test_coverage": {
        "command": "npm test -- --coverage",
        "description": "Run tests with coverage report"
      }
    }
  }
}
```

#### Type Check
Run TypeScript type checking.

```json
{
  "daemon": {
    "actions": {
      "typecheck": {
        "command": "npm run typecheck",
        "description": "Run TypeScript type checker"
      }
    }
  }
}
```

#### Lint and Fix
Run linter with auto-fix.

```json
{
  "daemon": {
    "actions": {
      "lint_fix": {
        "command": "npm run lint -- --fix",
        "description": "Run linter with auto-fix"
      }
    }
  }
}
```

---

### 2. macOS/Swift Development

#### Generate Xcode Project
Generate Xcode project from Swift package.

```json
{
  "daemon": {
    "actions": {
      "gen_xcode": {
        "command": "./scripts/gen_xcode.sh",
        "description": "Generate Xcode project from Swift package"
      }
    }
  }
}
```

#### Xcode Build
Build project using xcodebuild.

```json
{
  "daemon": {
    "actions": {
      "xcode_build": {
        "command": "xcodebuild -project MyApp.xcodeproj -scheme MyApp -configuration Debug build",
        "description": "Build in Debug mode via Xcode"
      }
    }
  }
}
```

#### Xcode Test
Run tests via xcodebuild.

```json
{
  "daemon": {
    "actions": {
      "xcode_test": {
        "command": "xcodebuild -project MyApp.xcodeproj -scheme MyApp test",
        "description": "Run tests via xcodebuild"
      }
    }
  }
}
```

#### Open in Xcode
Open project in Xcode.

```json
{
  "daemon": {
    "actions": {
      "open_xcode": {
        "command": "open *.xcodeproj",
        "description": "Open project in Xcode"
      }
    }
  }
}
```

---

### 3. Deployment Actions

#### Deploy to Staging
Deploy application to staging environment.

```json
{
  "daemon": {
    "actions": {
      "deploy_staging": {
        "command": "./scripts/deploy.sh --env staging",
        "description": "Deploy to staging environment"
      }
    }
  }
}
```

#### Deploy to Production
Deploy application to production (with confirmation).

```json
{
  "daemon": {
    "actions": {
      "deploy_prod": {
        "command": "./scripts/deploy.sh --env production --confirm",
        "description": "Deploy to production environment"
      }
    }
  }
}
```

#### Fastlane Beta (iOS)
Deploy to TestFlight.

```json
{
  "daemon": {
    "actions": {
      "fastlane_beta": {
        "command": "cd scripts/fastlane && fastlane beta",
        "description": "Deploy to TestFlight via Fastlane"
      }
    }
  }
}
```

#### Fastlane Release (iOS)
Deploy to App Store.

```json
{
  "daemon": {
    "actions": {
      "fastlane_release": {
        "command": "cd scripts/fastlane && fastlane release",
        "description": "Deploy to App Store via Fastlane"
      }
    }
  }
}
```

#### Docker Build and Push
Build and push Docker image.

```json
{
  "daemon": {
    "actions": {
      "docker_push": {
        "command": "docker build -t myapp:latest . && docker push myapp:latest",
        "description": "Build and push Docker image"
      }
    }
  }
}
```

---

### 4. Logging & Monitoring

#### Log Task Completion
Log completed tasks to a file.

```json
{
  "daemon": {
    "actions": {
      "log_task": {
        "command": "echo \"$(date '+%Y-%m-%d %H:%M:%S') - Task completed:\" >> log.txt && echo",
        "description": "Log task completion to file"
      }
    }
  }
}
```

#### Log Ralph Complete
Log when all PRD tasks are complete.

```json
{
  "daemon": {
    "actions": {
      "log_complete": {
        "command": "echo \"$(date '+%Y-%m-%d %H:%M:%S') - Ralph finished: All PRD tasks complete\" >> log.txt",
        "description": "Log ralph completion to file"
      }
    }
  }
}
```

#### Log with JSON Format
Log events in JSON format for parsing.

```json
{
  "daemon": {
    "actions": {
      "log_json": {
        "command": "echo '{\"timestamp\":\"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'\",\"event\":\"task_complete\",\"message\":\"'$RALPH_MESSAGE'\"}' >> events.jsonl",
        "description": "Log events in JSON Lines format"
      }
    }
  }
}
```

---

### 5. Git & Version Control

#### Git Status
Show git status.

```json
{
  "daemon": {
    "actions": {
      "git_status": {
        "command": "git status",
        "description": "Show git repository status"
      }
    }
  }
}
```

#### Git Diff
Show uncommitted changes.

```json
{
  "daemon": {
    "actions": {
      "git_diff": {
        "command": "git diff",
        "description": "Show uncommitted changes"
      }
    }
  }
}
```

#### Create Git Tag
Create a version tag.

```json
{
  "daemon": {
    "actions": {
      "git_tag": {
        "command": "git tag -a v$(date +%Y%m%d.%H%M%S) -m 'Auto-tagged by Ralph'",
        "description": "Create timestamped git tag"
      }
    }
  }
}
```

#### Push to Remote
Push changes to remote repository.

```json
{
  "daemon": {
    "actions": {
      "git_push": {
        "command": "git push origin HEAD",
        "description": "Push current branch to origin"
      }
    }
  }
}
```

---

### 6. Notification Actions

#### Desktop Notification (macOS)
Send macOS desktop notification.

```json
{
  "daemon": {
    "actions": {
      "notify_macos": {
        "command": "osascript -e 'display notification \"$RALPH_MESSAGE\" with title \"Ralph\"'",
        "description": "Send macOS desktop notification"
      }
    }
  }
}
```

#### Slack Notification
Send notification to Slack webhook.

```json
{
  "daemon": {
    "actions": {
      "notify_slack": {
        "command": "curl -X POST -H 'Content-type: application/json' --data '{\"text\":\"Ralph: Task completed\"}' $SLACK_WEBHOOK_URL",
        "description": "Send Slack notification"
      }
    }
  }
}
```

#### Discord Notification
Send notification to Discord webhook.

```json
{
  "daemon": {
    "actions": {
      "notify_discord": {
        "command": "curl -X POST -H 'Content-type: application/json' --data '{\"content\":\"Ralph: Task completed\"}' $DISCORD_WEBHOOK_URL",
        "description": "Send Discord notification"
      }
    }
  }
}
```

#### Play Sound (macOS)
Play a sound when task completes.

```json
{
  "daemon": {
    "actions": {
      "play_sound": {
        "command": "afplay /System/Library/Sounds/Glass.aiff",
        "description": "Play completion sound"
      }
    }
  }
}
```

---

### 7. Database Actions

#### Run Database Migrations
Run database migrations.

```json
{
  "daemon": {
    "actions": {
      "db_migrate": {
        "command": "npm run db:migrate",
        "description": "Run database migrations"
      }
    }
  }
}
```

#### Database Backup
Create database backup.

```json
{
  "daemon": {
    "actions": {
      "db_backup": {
        "command": "pg_dump -U $DB_USER $DB_NAME > backups/backup_$(date +%Y%m%d_%H%M%S).sql",
        "description": "Create database backup"
      }
    }
  }
}
```

#### Seed Database
Seed database with test data.

```json
{
  "daemon": {
    "actions": {
      "db_seed": {
        "command": "npm run db:seed",
        "description": "Seed database with test data"
      }
    }
  }
}
```

---

### 8. Environment & Utilities

#### Open Browser
Open URL in default browser.

```json
{
  "daemon": {
    "actions": {
      "open_browser": {
        "command": "open http://localhost:3000",
        "description": "Open app in browser"
      }
    }
  }
}
```

#### Clear Cache
Clear application cache.

```json
{
  "daemon": {
    "actions": {
      "clear_cache": {
        "command": "rm -rf .cache node_modules/.cache",
        "description": "Clear application cache"
      }
    }
  }
}
```

#### Kill Port
Kill process on a specific port.

```json
{
  "daemon": {
    "actions": {
      "kill_port_3000": {
        "command": "lsof -ti:3000 | xargs kill -9 2>/dev/null || true",
        "description": "Kill process on port 3000"
      }
    }
  }
}
```

#### Check System Resources
Display system resource usage.

```json
{
  "daemon": {
    "actions": {
      "system_check": {
        "command": "echo '=== Disk ===' && df -h . && echo '=== Memory ===' && free -h 2>/dev/null || vm_stat",
        "description": "Check disk and memory usage"
      }
    }
  }
}
```

---

## Event Configuration

Actions can be automatically triggered by Ralph events. Add an `events` section to your daemon config:

```json
{
  "daemon": {
    "actions": {
      "log_task": {
        "command": "echo \"$(date '+%Y-%m-%d %H:%M:%S') - Task: $RALPH_MESSAGE\" >> log.txt",
        "description": "Log task completion"
      },
      "log_complete": {
        "command": "echo \"$(date '+%Y-%m-%d %H:%M:%S') - All tasks complete\" >> log.txt",
        "description": "Log ralph completion"
      },
      "play_sound": {
        "command": "afplay /System/Library/Sounds/Glass.aiff",
        "description": "Play completion sound"
      }
    },
    "events": {
      "task_complete": [
        {
          "action": "log_task",
          "message": "{{task}}"
        }
      ],
      "ralph_complete": [
        {
          "action": "log_complete"
        },
        {
          "action": "notify",
          "message": "All tasks done!"
        },
        {
          "action": "play_sound"
        }
      ],
      "error": [
        {
          "action": "notify",
          "message": "Error occurred: {{error}}"
        }
      ]
    }
  }
}
```

### Available Events

| Event | Description | Placeholders |
|-------|-------------|--------------|
| `task_complete` | After each task is marked as passing | `{{task}}` |
| `ralph_complete` | When all PRD tasks are complete | - |
| `iteration_complete` | After each `ralph once` iteration | - |
| `error` | When an error occurs | `{{error}}` |

---

## Complete Example Configuration

Here's a comprehensive config with multiple useful actions:

```json
{
  "daemon": {
    "actions": {
      "build": {
        "command": "npm run build",
        "description": "Build the project"
      },
      "test": {
        "command": "npm test",
        "description": "Run tests"
      },
      "lint": {
        "command": "npm run lint -- --fix",
        "description": "Run linter with auto-fix"
      },
      "deploy_staging": {
        "command": "./scripts/deploy.sh --env staging",
        "description": "Deploy to staging"
      },
      "log_task": {
        "command": "echo \"$(date '+%Y-%m-%d %H:%M:%S') - $RALPH_MESSAGE\" >> ralph.log",
        "description": "Log task to file"
      },
      "notify_desktop": {
        "command": "osascript -e 'display notification \"$RALPH_MESSAGE\" with title \"Ralph\"'",
        "description": "Send desktop notification"
      },
      "open_browser": {
        "command": "open http://localhost:3000",
        "description": "Open app in browser"
      },
      "git_status": {
        "command": "git status --short",
        "description": "Show git status"
      }
    },
    "events": {
      "task_complete": [
        {
          "action": "log_task",
          "message": "Completed: {{task}}"
        }
      ],
      "ralph_complete": [
        {
          "action": "notify",
          "message": "All tasks complete!"
        },
        {
          "action": "deploy_staging"
        }
      ]
    }
  }
}
```

---

## Tips

1. **Use `$RALPH_MESSAGE`**: Actions receive arguments via the `RALPH_MESSAGE` environment variable.

2. **Chain commands**: Use `&&` to run multiple commands in sequence:
   ```json
   "command": "npm run build && npm run test"
   ```

3. **Silent failures**: Use `|| true` to prevent action failures from stopping the workflow:
   ```json
   "command": "some-command || true"
   ```

4. **Background processes**: Use `&` to run commands in the background:
   ```json
   "command": "npm run dev &"
   ```

5. **Working directory**: Commands run from the project root directory on the host.

6. **Environment variables**: Host environment variables are available to actions.

---

## Troubleshooting

### Action Fails with "No response from daemon (timeout)"

The daemon is not running or not responding. Start it with:

```bash
ralph daemon start
```

Make sure to run the daemon on the **host machine**, not inside a container.

### Built-in Action Shows "Unknown action"

This happens when:

1. **The action's provider isn't configured**: For example, `telegram_notify` won't appear if Telegram isn't configured in `config.json`
2. **Using an outdated config**: Re-run `ralph init` or manually add the required configuration

Check available actions with:

```bash
ralph action --list
```

### Action Works on Host but Not in Container

Verify that:

1. The `.ralph` directory is mounted in the container (automatic with `ralph docker run`)
2. The daemon is running on the host
3. The messages file exists: `.ralph/messages.json`

### Custom Action Not Executing

1. Check that the action is defined in `daemon.actions` in `.ralph/config.json`
2. Verify the command path is correct and executable
3. Test the command manually on the host first

### Notifications Not Being Sent

For ntfy:
- Verify `notifications.provider` is set to `"ntfy"`
- Check that `notifications.ntfy.topic` is set
- Test manually: `curl -d "test" https://ntfy.sh/your-topic`

For Telegram:
- Verify `chat.telegram.botToken` is set
- Verify `chat.telegram.allowedChatIds` contains your chat ID
- Check the daemon logs for errors

### Actions Timing Out

Actions have a 60-second timeout by default. For long-running actions:

1. Consider running them in the background: `"command": "long-task.sh &"`
2. Or increase the timeout in the command itself
3. For very long tasks, trigger them asynchronously and poll for completion

### Debug Mode

Run actions with debug output:

```bash
ralph action --debug <name>
```

Or start the daemon in debug mode:

```bash
ralph daemon start --debug
```

This shows detailed message queue activity and can help identify where issues occur.
