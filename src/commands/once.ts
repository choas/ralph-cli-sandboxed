import { spawn } from "child_process";
import { checkFilesExist, loadConfig, loadPrompt, getPaths, getCliConfig, requireContainer } from "../utils/config.js";
import { resolvePromptVariables } from "../templates/prompts.js";

export async function once(args: string[]): Promise<void> {
  // Parse flags
  let debug = false;
  let model: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--debug" || args[i] === "-d") {
      debug = true;
    } else if (args[i] === "--model" || args[i] === "-m") {
      if (i + 1 < args.length) {
        model = args[i + 1];
        i++; // Skip the model value
      } else {
        console.error("Error: --model requires a value");
        process.exit(1);
      }
    }
  }

  requireContainer("once");
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
  const cliConfig = getCliConfig(config);

  console.log("Starting single ralph iteration...\n");

  // Build CLI arguments: config args + yolo args + model args + prompt args
  // Use yoloArgs from config if available, otherwise default to Claude's --dangerously-skip-permissions
  const yoloArgs = cliConfig.yoloArgs ?? ["--dangerously-skip-permissions"];
  const promptArgs = cliConfig.promptArgs ?? ["-p"];
  const promptValue = `@${paths.prd} @${paths.progress} ${prompt}`;
  const cliArgs = [
    ...(cliConfig.args ?? []),
    ...yoloArgs,
  ];

  // Add model args if model is specified
  if (model && cliConfig.modelArgs) {
    cliArgs.push(...cliConfig.modelArgs, model);
  }

  cliArgs.push(...promptArgs, promptValue);

  if (debug) {
    console.log(`[debug] ${cliConfig.command} ${cliArgs.map(a => a.includes(" ") ? `"${a}"` : a).join(" ")}\n`);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(cliConfig.command, cliArgs, {
      stdio: "inherit",
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        console.error(`\n${cliConfig.command} exited with code ${code}`);
      }
      resolve();
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to start ${cliConfig.command}: ${err.message}`));
    });
  });
}
