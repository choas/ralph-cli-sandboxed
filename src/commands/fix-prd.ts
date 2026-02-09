import { existsSync, readFileSync, copyFileSync } from "fs";
import { join, isAbsolute, extname } from "path";
import { getPaths, getRalphDir, getPrdFiles } from "../utils/config.js";
import {
  validatePrd,
  attemptRecovery,
  createBackup,
  findLatestBackup,
  createTemplatePrd,
  readPrdFile,
  writePrdAuto,
} from "../utils/prd-validator.js";
import YAML from "yaml";
import { robustYamlParse } from "../utils/prd-validator.js";

/**
 * Resolves a backup path - can be absolute, relative, or just a filename.
 */
function resolveBackupPath(backupArg: string): string {
  if (isAbsolute(backupArg)) {
    return backupArg;
  }
  // Check if it's in the .ralph directory
  const inRalphDir = join(getRalphDir(), backupArg);
  if (existsSync(inRalphDir)) {
    return inRalphDir;
  }
  // Otherwise treat as relative to cwd
  return join(process.cwd(), backupArg);
}

/**
 * Parses a backup file content based on file extension.
 * Supports both JSON and YAML formats.
 */
function parseBackupContent(backupPath: string, content: string): unknown {
  const ext = extname(backupPath).toLowerCase();
  if (ext === ".yaml" || ext === ".yml") {
    return robustYamlParse(content);
  }
  return JSON.parse(content);
}

/**
 * Restores PRD from a specific backup file.
 * Supports restoring from both .json and .yaml/.yml backup files.
 * Writes output in the same format as the target PRD file.
 */
function restoreFromBackup(prdPath: string, backupPath: string): boolean {
  if (!existsSync(backupPath)) {
    console.error(`Error: Backup file not found: ${backupPath}`);
    return false;
  }

  try {
    const backupContent = readFileSync(backupPath, "utf-8");
    const backupParsed = parseBackupContent(backupPath, backupContent);
    const validation = validatePrd(backupParsed);

    if (!validation.valid) {
      console.error("Error: Backup file contains invalid PRD structure:");
      validation.errors.slice(0, 3).forEach((err) => {
        console.error(`  - ${err}`);
      });
      return false;
    }

    // Create backup of current file before overwriting
    if (existsSync(prdPath)) {
      const currentBackup = createBackup(prdPath);
      console.log(`Created backup of current PRD: ${currentBackup}`);
    }

    // Write in the same format as the target PRD file
    writePrdAuto(prdPath, validation.data!);
    console.log(`\x1b[32m✓ PRD restored from: ${backupPath}\x1b[0m`);
    console.log(`  Restored ${validation.data!.length} entries.`);
    return true;
  } catch (err) {
    console.error(`Error: Failed to read backup file: ${err}`);
    return false;
  }
}

/**
 * Handles the case where the PRD file contains invalid JSON/YAML.
 * Attempts to restore from backup or reset to template.
 * Preserves the original file format (JSON or YAML).
 */
function handleBrokenPrd(prdPath: string): void {
  // Create backup of the broken file (preserving raw content and extension)
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const ext = extname(prdPath).toLowerCase();
  const backupExt = ext === ".yaml" || ext === ".yml" ? ext : ".json";
  const backupPath = join(getRalphDir(), `backup.prd.${timestamp}${backupExt}`);
  copyFileSync(prdPath, backupPath);
  console.log(`Created backup of broken file: ${backupPath}\n`);

  // Try to restore from a previous valid backup
  const latestBackup = findLatestBackup(prdPath);

  if (latestBackup && latestBackup !== backupPath) {
    console.log(`Found previous backup: ${latestBackup}`);

    try {
      const backupContent = readFileSync(latestBackup, "utf-8");
      const backupParsed = parseBackupContent(latestBackup, backupContent);
      const backupValidation = validatePrd(backupParsed);

      if (backupValidation.valid) {
        writePrdAuto(prdPath, backupValidation.data!);
        console.log("\x1b[32m✓ PRD restored from backup!\x1b[0m");
        console.log(`  Restored ${backupValidation.data!.length} entries.`);
        console.log("\x1b[33m  Note: Recent changes may have been lost.\x1b[0m");
        return;
      } else {
        console.log("  Backup is also invalid, cannot restore.\n");
      }
    } catch {
      console.log("  Failed to read backup file.\n");
    }
  } else {
    console.log("  No valid backup found to restore from.\n");
  }

  // Reset to template as last resort - with instructions to recover from backup
  console.log("Resetting PRD to recovery template...");
  writePrdAuto(prdPath, createTemplatePrd(backupPath));
  console.log("\x1b[33m✓ PRD reset with recovery task.\x1b[0m");
  console.log("  Next 'ralph run' will instruct the LLM to recover entries from backup.");
  console.log(`  Backup location: ${backupPath}`);
}

export async function fixPrd(args: string[] = []): Promise<void> {
  // Parse arguments
  let verifyOnly = false;
  let backupFile: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--verify" || args[i] === "-v") {
      verifyOnly = true;
    } else if (!args[i].startsWith("-")) {
      backupFile = args[i];
    }
  }

  const paths = getPaths();

  // If a backup file is specified, restore from it
  if (backupFile) {
    const resolvedPath = resolveBackupPath(backupFile);
    const success = restoreFromBackup(paths.prd, resolvedPath);
    process.exit(success ? 0 : 1);
  }

  // Detect which PRD files exist
  const prdFiles = getPrdFiles();

  if (prdFiles.none) {
    console.error("Error: No PRD file found (.ralph/prd.yaml or .ralph/prd.json). Run 'ralph init' first.");
    process.exit(1);
  }

  // Use the primary PRD path (YAML preferred over JSON)
  const prdPath = paths.prd;
  const isYamlFile = extname(prdPath).toLowerCase() === ".yaml" || extname(prdPath).toLowerCase() === ".yml";
  const fileFormatName = isYamlFile ? "YAML" : "JSON";

  console.log(`Checking PRD structure (${fileFormatName})...\n`);

  // Step 1: Try to read and parse the file
  const parsed = readPrdFile(prdPath);

  if (!parsed) {
    // Parsing failed - file is completely broken
    console.log(`\x1b[31m✗ PRD file contains invalid ${fileFormatName}.\x1b[0m\n`);
    if (verifyOnly) {
      process.exit(1);
    }
    handleBrokenPrd(prdPath);
    return;
  }

  // Step 2: Validate the structure
  const validation = validatePrd(parsed.content);

  if (validation.valid) {
    console.log("\x1b[32m✓ PRD is valid.\x1b[0m");
    console.log(`  ${validation.data!.length} entries found.`);
    return;
  }

  // PRD is invalid
  console.log("\x1b[31m✗ PRD structure is invalid:\x1b[0m");
  validation.errors.slice(0, 5).forEach((err) => {
    console.log(`  - ${err}`);
  });
  if (validation.errors.length > 5) {
    console.log(`  - ... and ${validation.errors.length - 5} more errors`);
  }
  console.log();

  if (verifyOnly) {
    process.exit(1);
  }

  // Step 3: Create backup before any modifications
  const backupPath = createBackup(prdPath);
  console.log(`Created backup: ${backupPath}\n`);

  // Step 4: Attempt recovery strategies
  console.log("Attempting recovery...\n");

  // Strategy 1: Try to recover from malformed structure
  const recovered = attemptRecovery(parsed.content);

  if (recovered) {
    // Validate the recovered data
    const recoveredValidation = validatePrd(recovered);

    if (recoveredValidation.valid) {
      writePrdAuto(prdPath, recovered);
      console.log("\x1b[32m✓ PRD recovered successfully!\x1b[0m");
      console.log(`  Recovered ${recovered.length} entries by unwrapping/remapping fields.`);
      return;
    }
  }

  console.log("  Direct recovery failed.\n");

  // Strategy 2: Restore from backup
  const latestBackup = findLatestBackup(prdPath);

  if (latestBackup && latestBackup !== backupPath) {
    console.log(`Found previous backup: ${latestBackup}`);

    try {
      const backupContent = readFileSync(latestBackup, "utf-8");
      const backupParsed = parseBackupContent(latestBackup, backupContent);
      const backupValidation = validatePrd(backupParsed);

      if (backupValidation.valid) {
        writePrdAuto(prdPath, backupValidation.data!);
        console.log("\x1b[32m✓ PRD restored from backup!\x1b[0m");
        console.log(`  Restored ${backupValidation.data!.length} entries.`);
        console.log("\x1b[33m  Note: Recent changes may have been lost.\x1b[0m");
        return;
      } else {
        console.log("  Backup is also invalid, cannot restore.\n");
      }
    } catch {
      console.log("  Failed to read backup file.\n");
    }
  } else {
    console.log("  No valid backup found to restore from.\n");
  }

  // Strategy 3: Reset to recovery template - LLM will fix it on next run
  console.log("Resetting PRD to recovery template...");
  writePrdAuto(prdPath, createTemplatePrd(backupPath));
  console.log("\x1b[33m✓ PRD reset with recovery task.\x1b[0m");
  console.log("  Next 'ralph run' will instruct the LLM to recover entries from backup.");
  console.log(`  Backup location: ${backupPath}`);
}
