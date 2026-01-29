# macOS/Swift Development with Ralph

Ralph enables macOS and Swift/SwiftUI development from within a sandboxed Docker container. Since Xcode and macOS-specific tooling cannot run inside Linux containers, Ralph uses a host daemon to execute platform-specific operations on the macOS host.

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                     Docker Container (Sandbox)                   │
│                                                                  │
│  ┌──────────────┐    ┌───────────────┐    ┌──────────────────┐  │
│  │ Claude Code  │───▶│  Swift files  │───▶│ ralph action     │  │
│  │ (AI Agent)   │    │  (edits code) │    │ gen_xcode        │  │
│  └──────────────┘    └───────────────┘    └────────┬─────────┘  │
│                                                     │            │
│                              .ralph/messages.json ──┘            │
└──────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼ File-based message queue
┌──────────────────────────────────────────────────────────────────┐
│                        macOS Host                                 │
│                                                                   │
│  ┌──────────────┐    ┌───────────────┐    ┌──────────────────┐   │
│  │ ralph daemon │───▶│ gen_xcode.sh  │───▶│ Xcode Project    │   │
│  │ (listening)  │    │ (executes)    │    │ (.xcodeproj)     │   │
│  └──────────────┘    └───────────────┘    └──────────────────┘   │
│                                                                   │
│                       ┌───────────────────────────────────┐       │
│                       │ xcodebuild / Xcode IDE            │       │
│                       │ (builds, signs, runs app)         │       │
│                       └───────────────────────────────────┘       │
└───────────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Initialize a Swift/SwiftUI Project

```bash
ralph init
# Select: Swift
# Select technologies: SwiftUI, Fastlane (optional)
```

This creates:
- `.ralph/config.json` with macOS development actions
- `scripts/gen_xcode.sh` for Xcode project generation
- `scripts/fastlane/` (if Fastlane selected) for deployment automation

### 2. Start the Host Daemon

The daemon runs on your macOS host and executes actions triggered from the sandbox:

```bash
# Terminal 1: Start the daemon
ralph daemon start
```

### 3. Run the Sandbox

```bash
# Terminal 2: Run the container
ralph docker run
```

### 4. Trigger Host Actions

From inside the container, trigger Xcode project generation:

```bash
# Inside container
ralph action gen_xcode
```

The daemon executes `./scripts/gen_xcode.sh` on the host, which:
1. Generates `Info.plist` and entitlements if missing
2. Creates `project.yml` for xcodegen (or uses `swift package generate-xcodeproj`)
3. Outputs `YourProject.xcodeproj`

## Example Workflow

Here's a typical development flow with Ralph and Swift/SwiftUI:

### Step 1: AI Edits Code in Sandbox

The AI agent (Claude Code) edits Swift source files inside the container:

```
Sources/
└── MyApp/
    ├── MyAppApp.swift
    ├── ContentView.swift
    └── Models/
        └── User.swift
```

### Step 2: Generate Xcode Project

When ready to build, the AI or you triggers the action:

```bash
# Inside container
ralph action gen_xcode
```

Output:
```
Executing action: gen_xcode
Waiting for daemon response...

Generating Xcode project: MyApp
Project root: /path/to/project
Creating Info.plist...
Creating entitlements file...
Using xcodegen to generate Xcode project...
Xcode project generated successfully!

Action 'gen_xcode' completed successfully.
```

### Step 3: Build with Xcode

After the project is generated, build it on the host:

```bash
# Inside container - triggers host xcodebuild
ralph action build
```

Or open in Xcode:

```bash
# On macOS host
open MyApp.xcodeproj
```

### Step 4: Iterate

1. AI continues editing Swift files in the sandbox
2. Trigger `ralph action gen_xcode` to regenerate the project
3. Build and test on host
4. Repeat

## Available Actions

When you initialize a Swift + SwiftUI project, Ralph automatically configures these daemon actions:

| Action | Command | Description |
|--------|---------|-------------|
| `gen_xcode` | `./scripts/gen_xcode.sh` | Generate Xcode project from Swift package |
| `build` | `xcodebuild ... Debug build` | Build the project in Debug mode |
| `test` | `xcodebuild ... test` | Run tests via xcodebuild |

If you selected Fastlane technology, additional actions are available:

| Action | Command | Description |
|--------|---------|-------------|
| `fastlane_init` | `cd scripts/fastlane && fastlane init` | Initialize Fastlane credentials |
| `fastlane_beta` | `cd scripts/fastlane && fastlane beta` | Deploy to TestFlight |
| `fastlane_release` | `cd scripts/fastlane && fastlane release` | Submit to App Store |

### Listing Actions

```bash
# Inside container
ralph action --list

# Output:
# Available actions:
#   gen_xcode            Generate Xcode project from Swift package
#   build                Build the Xcode project in Debug mode
#   test                 Run tests via xcodebuild
#   fastlane_beta        Deploy beta build via Fastlane
```

### Custom Actions

Add custom actions in `.ralph/config.json`:

```json
{
  "daemon": {
    "actions": {
      "gen_xcode": {
        "command": "./scripts/gen_xcode.sh",
        "description": "Generate Xcode project from Swift package"
      },
      "archive": {
        "command": "xcodebuild -project *.xcodeproj -scheme * archive -archivePath build/MyApp.xcarchive",
        "description": "Create an archive for distribution"
      },
      "clean": {
        "command": "rm -rf build/ DerivedData/ *.xcodeproj",
        "description": "Clean all build artifacts"
      }
    }
  }
}
```

## Configuration Details

### gen_xcode.sh Script

The generated script (`scripts/gen_xcode.sh`) handles Xcode project generation:

```bash
./scripts/gen_xcode.sh              # Uses default project name
./scripts/gen_xcode.sh MyAwesomeApp # Custom project name
```

**What it does:**

1. **Creates Info.plist** - Standard macOS app Info.plist with bundle configuration
2. **Creates entitlements** - App sandbox, network, and file access entitlements
3. **Generates project.yml** - Configuration for xcodegen (if available)
4. **Runs xcodegen** - Preferred method for SwiftUI apps
5. **Falls back to SPM** - Uses `swift package generate-xcodeproj` if xcodegen unavailable

**Requirements:**

- Swift toolchain installed on host
- Xcode command line tools
- xcodegen (recommended): `brew install xcodegen`

### Fastlane Configuration

If you selected Fastlane during init, Ralph generates:

```
scripts/fastlane/
├── Fastfile    # Lane definitions (tests, beta, release)
├── Appfile     # App bundle ID and Apple Developer config
└── README.md   # Fastlane documentation
```

See [scripts/fastlane/README.md](../scripts/fastlane/README.md) for Fastlane setup instructions.

## Troubleshooting

### Daemon not responding

**Symptom:** `ralph action gen_xcode` hangs or times out.

**Solution:**
1. Ensure the daemon is running on the host:
   ```bash
   ralph daemon status
   ralph daemon start
   ```
2. Check that `.ralph/` directory is mounted in the container (should be automatic with `ralph docker run`)

### "Package.swift not found" error

**Symptom:** gen_xcode.sh fails with "Package.swift not found in project root"

**Solution:** Create a Swift package manifest:
```swift
// Package.swift
// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "MyApp",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(name: "MyApp", path: "Sources/MyApp")
    ]
)
```

### Xcode signing errors

**Symptom:** Build fails with "No signing certificate" or "Provisioning profile" errors.

**Solutions:**

1. **Automatic signing:** Open the project in Xcode and enable "Automatically manage signing"

2. **Set Team ID in project.yml:**
   ```yaml
   settings:
     base:
       DEVELOPMENT_TEAM: "YOUR_TEAM_ID"
   ```

3. **Use Fastlane match:** For teams, set up [match](https://docs.fastlane.tools/actions/match/) for certificate management

### xcodegen not found

**Symptom:** gen_xcode.sh uses deprecated `swift package generate-xcodeproj`

**Solution:** Install xcodegen on the host:
```bash
brew install xcodegen
```

### SwiftUI app won't run

**Symptom:** App builds but crashes or shows blank window.

**Checklist:**
1. Ensure `@main` App struct exists:
   ```swift
   @main
   struct MyAppApp: App {
       var body: some Scene {
           WindowGroup {
               ContentView()
           }
       }
   }
   ```

2. Check Info.plist has correct principal class:
   ```xml
   <key>NSPrincipalClass</key>
   <string>NSApplication</string>
   ```

3. Verify deployment target in project.yml:
   ```yaml
   deploymentTarget:
     macOS: "13.0"
   ```

### Build errors after regenerating project

**Symptom:** Build fails after running `ralph action gen_xcode`

**Solutions:**

1. **Clean build folder:**
   ```bash
   # On host
   rm -rf DerivedData/
   xcodebuild clean -project *.xcodeproj -scheme *
   ```

2. **Reset package cache:**
   ```bash
   swift package reset
   swift package resolve
   ```

3. **Regenerate from scratch:**
   ```bash
   rm -rf *.xcodeproj project.yml
   ralph action gen_xcode
   ```

### Entitlements issues

**Symptom:** App crashes with sandbox violations or capability errors.

**Solution:** Edit the generated entitlements file at `Sources/MyApp/Supporting Files/MyApp.entitlements`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <!-- App Sandbox (required for App Store) -->
    <key>com.apple.security.app-sandbox</key>
    <true/>

    <!-- Network access -->
    <key>com.apple.security.network.client</key>
    <true/>

    <!-- File access -->
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>

    <!-- Add more capabilities as needed -->
    <!-- Camera: com.apple.security.device.camera -->
    <!-- Microphone: com.apple.security.device.audio-input -->
    <!-- Location: com.apple.security.personal-information.location -->
</dict>
</plist>
```

After modifying entitlements, regenerate the project:
```bash
ralph action gen_xcode
```

## Tips

### Use Telegram for Remote Triggering

With Ralph's Telegram integration, you can trigger actions remotely:

```
/notify gen_xcode     # Generate Xcode project
/notify build         # Build the project
/notify fastlane_beta # Deploy to TestFlight
```

See the [Chat documentation](../README.md#chat-client-configuration) for setup.

### Watching for Changes

For continuous development, you can set up the daemon to watch for file changes and auto-regenerate the Xcode project. Add a custom action:

```json
{
  "daemon": {
    "actions": {
      "watch": {
        "command": "fswatch -o Sources/ | xargs -n1 -I{} ./scripts/gen_xcode.sh",
        "description": "Watch sources and regenerate on change"
      }
    }
  }
}
```

### Debugging in Xcode

1. Generate the Xcode project: `ralph action gen_xcode`
2. Open in Xcode: `open *.xcodeproj`
3. Set breakpoints and run (Cmd+R)
4. Changes made in the sandbox require regenerating the project

### SwiftUI Previews

SwiftUI previews require the full Xcode IDE:

1. Open the generated project in Xcode
2. Navigate to a SwiftUI view file
3. Press Opt+Cmd+Return to show the canvas
4. Previews will update as you edit in Xcode

For AI-driven development, edits happen in the sandbox, and you regenerate + preview in Xcode.
