/**
 * macOS/Swift development script templates
 * These scripts are generated when Swift + SwiftUI is selected during ralph init
 */

/**
 * Generate gen_xcode.sh script content
 * This script generates an Xcode project from a Swift package, supporting SwiftUI apps
 *
 * Usage: ./scripts/gen_xcode.sh [project_name]
 *
 * @param projectName - Default project name (can be overridden by script argument)
 */
export function generateGenXcodeScript(projectName: string = "App"): string {
  return `#!/bin/bash
#
# gen_xcode.sh - Generate Xcode project from Swift package
#
# This script generates an Xcode project from a Swift package, with support
# for SwiftUI macOS applications including proper Info.plist and entitlements.
#
# USAGE:
#   ./scripts/gen_xcode.sh [project_name]
#
# ARGUMENTS:
#   project_name  - Name of the project/app (default: ${projectName})
#
# EXAMPLES:
#   ./scripts/gen_xcode.sh                  # Uses default project name
#   ./scripts/gen_xcode.sh MyAwesomeApp     # Creates MyAwesomeApp.xcodeproj
#
# REQUIREMENTS:
#   - Swift toolchain installed
#   - Xcode command line tools
#   - For SwiftUI apps: xcodegen (brew install xcodegen) OR swift package generate-xcodeproj
#
# OUTPUT:
#   - Creates <project_name>.xcodeproj in the project root
#   - Generates Info.plist if not present
#   - Generates entitlements file if not present
#
# This script is designed to be run on the host macOS system (not in Docker)
# since Xcode and macOS-specific tooling is required.
#

set -e

PROJECT_NAME="\${1:-${projectName}}"
SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "Generating Xcode project: \$PROJECT_NAME"
echo "Project root: \$PROJECT_ROOT"
echo ""

cd "$PROJECT_ROOT"

# Check if Package.swift exists
if [ ! -f "Package.swift" ]; then
  echo "Error: Package.swift not found in project root"
  echo "This script requires a Swift Package Manager project"
  exit 1
fi

# Create Supporting Files directory for Info.plist and entitlements
SUPPORT_DIR="$PROJECT_ROOT/Sources/\$PROJECT_NAME/Supporting Files"
mkdir -p "$SUPPORT_DIR"

# Generate Info.plist if it doesn't exist
INFO_PLIST="$SUPPORT_DIR/Info.plist"
if [ ! -f "$INFO_PLIST" ]; then
  echo "Creating Info.plist..."
  cat > "$INFO_PLIST" << 'PLIST_EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>$(DEVELOPMENT_LANGUAGE)</string>
    <key>CFBundleExecutable</key>
    <string>$(EXECUTABLE_NAME)</string>
    <key>CFBundleIdentifier</key>
    <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>$(PRODUCT_NAME)</string>
    <key>CFBundlePackageType</key>
    <string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>LSMinimumSystemVersion</key>
    <string>$(MACOSX_DEPLOYMENT_TARGET)</string>
    <key>NSHumanReadableCopyright</key>
    <string>Copyright © 2024. All rights reserved.</string>
    <key>NSMainStoryboardFile</key>
    <string></string>
    <key>NSPrincipalClass</key>
    <string>NSApplication</string>
</dict>
</plist>
PLIST_EOF
  echo "Created: $INFO_PLIST"
fi

# Generate entitlements file if it doesn't exist
ENTITLEMENTS="$SUPPORT_DIR/\$PROJECT_NAME.entitlements"
if [ ! -f "$ENTITLEMENTS" ]; then
  echo "Creating entitlements file..."
  cat > "$ENTITLEMENTS" << 'ENTITLEMENTS_EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.app-sandbox</key>
    <true/>
    <key>com.apple.security.network.client</key>
    <true/>
    <key>com.apple.security.files.user-selected.read-write</key>
    <true/>
</dict>
</plist>
ENTITLEMENTS_EOF
  echo "Created: $ENTITLEMENTS"
fi

# Try xcodegen first (recommended for SwiftUI apps)
if command -v xcodegen &> /dev/null; then
  echo ""
  echo "Using xcodegen to generate Xcode project..."

  # Create project.yml if it doesn't exist
  PROJECT_YML="$PROJECT_ROOT/project.yml"
  if [ ! -f "$PROJECT_YML" ]; then
    echo "Creating project.yml for xcodegen..."
    cat > "$PROJECT_YML" << YAML_EOF
name: \$PROJECT_NAME
options:
  bundleIdPrefix: com.example
  deploymentTarget:
    macOS: "13.0"
  xcodeVersion: "15.0"
  generateEmptyDirectories: true

targets:
  \$PROJECT_NAME:
    type: application
    platform: macOS
    sources:
      - path: Sources/\$PROJECT_NAME
        excludes:
          - "**/*.entitlements"
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: com.example.\$PROJECT_NAME
        INFOPLIST_FILE: Sources/\$PROJECT_NAME/Supporting Files/Info.plist
        CODE_SIGN_ENTITLEMENTS: Sources/\$PROJECT_NAME/Supporting Files/\$PROJECT_NAME.entitlements
        MACOSX_DEPLOYMENT_TARGET: "13.0"
        SWIFT_VERSION: "5.9"
        DEVELOPMENT_TEAM: ""
        CODE_SIGN_STYLE: Automatic
        COMBINE_HIDPI_IMAGES: true
        ASSETCATALOG_COMPILER_APPICON_NAME: AppIcon
    dependencies: []
YAML_EOF
    echo "Created: $PROJECT_YML"
  fi

  xcodegen generate
  echo ""
  echo "Xcode project generated successfully!"

else
  # Fall back to swift package generate-xcodeproj (deprecated but still works)
  echo ""
  echo "xcodegen not found, using 'swift package generate-xcodeproj'..."
  echo "Note: For better SwiftUI support, consider installing xcodegen:"
  echo "  brew install xcodegen"
  echo ""

  swift package generate-xcodeproj
  echo ""
  echo "Xcode project generated successfully!"
  echo ""
  echo "Note: You may need to manually configure SwiftUI app settings in Xcode:"
  echo "  1. Set the app target type to 'Application'"
  echo "  2. Add Info.plist to the target"
  echo "  3. Configure signing and capabilities"
fi

echo ""
echo "Next steps:"
echo "  1. Open \$PROJECT_NAME.xcodeproj in Xcode"
echo "  2. Configure your Team ID for code signing"
echo "  3. Build and run (Cmd+R)"
echo ""
echo "If using xcodegen, you can regenerate the project anytime with:"
echo "  ./scripts/gen_xcode.sh"
`;
}

/**
 * Check if the selected technologies include SwiftUI
 */
export function hasSwiftUI(technologies: string[]): boolean {
  return technologies.some(tech =>
    tech.toLowerCase().includes('swiftui') ||
    tech.toLowerCase() === 'swiftui'
  );
}

/**
 * Check if the selected technologies include Fastlane
 */
export function hasFastlane(technologies: string[]): boolean {
  return technologies.some(tech =>
    tech.toLowerCase().includes('fastlane') ||
    tech.toLowerCase() === 'fastlane'
  );
}
