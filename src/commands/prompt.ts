import { loadConfig, loadPrompt, getPaths } from "../utils/config.js";
import { resolvePromptVariables } from "../templates/prompts.js";

export async function prompt(args: string[]): Promise<void> {
  const flag = args[0];

  if (flag === "--help" || flag === "-h") {
    console.log(`
ralph prompt - Display the resolved prompt for Claude Code

USAGE:
  ralph prompt              Print the full prompt with variables resolved
  ralph prompt --raw        Print the raw template with $variables
  ralph prompt --template   Print only the resolved template (no file refs)

DESCRIPTION:
  Prints the complete prompt that gets sent to Claude Code, including
  the @.ralph/prd.json and @.ralph/progress.txt file references.
  This is useful for testing the prompt manually in Claude Code.

TEMPLATE VARIABLES:
  $language      - The language/runtime name (e.g., "Kotlin")
  $technologies  - Comma-separated list of technologies
  $checkCommand  - The type/build check command
  $testCommand   - The test command

EXAMPLES:
  ralph prompt              # Print full prompt (with file refs)
  ralph prompt --raw        # Print template with $variables
  ralph prompt --template   # Print resolved template only
  ralph prompt | pbcopy     # Copy to clipboard (macOS)
`);
    return;
  }

  const config = loadConfig();
  const template = loadPrompt();
  const paths = getPaths();

  if (flag === "--raw") {
    console.log(template);
    return;
  }

  const resolved = resolvePromptVariables(template, {
    language: config.language,
    checkCommand: config.checkCommand,
    testCommand: config.testCommand,
    technologies: config.technologies,
  });

  if (flag === "--template") {
    console.log(resolved);
    return;
  }

  // Full prompt as sent to Claude (with file references)
  console.log(`@${paths.prd} @${paths.progress} ${resolved}`);
}
