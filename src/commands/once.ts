import { spawn } from "child_process";
import { checkFilesExist, loadConfig, loadPrompt, getPaths } from "../utils/config.js";
import { resolvePromptVariables } from "../templates/prompts.js";

export async function once(_args: string[]): Promise<void> {
  checkFilesExist();

  const config = loadConfig();
  const template = loadPrompt();
  const prompt = resolvePromptVariables(template, {
    language: config.language,
    checkCommand: config.checkCommand,
    testCommand: config.testCommand,
    technologies: config.technologies,
  });
  const paths = getPaths();

  console.log("Starting single ralph iteration...\n");

  return new Promise((resolve, reject) => {
    const proc = spawn(
      "claude",
      [
        "--permission-mode", "acceptEdits",
        "--dangerously-skip-permissions",
        "-p",
        `@${paths.prd} @${paths.progress} ${prompt}`,
      ],
      {
        stdio: "inherit",
        shell: true,
      }
    );

    proc.on("close", (code) => {
      if (code !== 0) {
        console.error(`\nClaude exited with code ${code}`);
      }
      resolve();
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to start claude: ${err.message}`));
    });
  });
}
