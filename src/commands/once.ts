import { spawn } from "child_process";
import { existsSync, appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import { checkFilesExist, loadConfig, loadPrompt, getPaths, getCliConfig, requireContainer } from "../utils/config.js";
import { resolvePromptVariables, getCliProviders } from "../templates/prompts.js";
import { getStreamJsonParser } from "../utils/stream-json.js";
import { sendNotificationWithDaemonEvents } from "../utils/notification.js";

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

  // Check if stream-json output is enabled
  const streamJsonConfig = config.docker?.asciinema?.streamJson;
  const streamJsonEnabled = streamJsonConfig?.enabled ?? false;
  const saveRawJson = streamJsonConfig?.saveRawJson !== false; // default true
  const outputDir = config.docker?.asciinema?.outputDir || ".recordings";

  // Get provider-specific streamJsonArgs (empty array if not defined)
  // This allows providers without JSON streaming to still have output displayed
  const providers = getCliProviders();
  const providerConfig = config.cliProvider ? providers[config.cliProvider] : providers["claude"];
  const streamJsonArgs = providerConfig?.streamJsonArgs ?? [];

  console.log("Starting single ralph iteration...");
  if (streamJsonEnabled) {
    console.log("Stream JSON output enabled - displaying formatted Claude output");
    if (saveRawJson) {
      console.log(`Raw JSON logs will be saved to: ${outputDir}/`);
    }
  }
  console.log();

  // Build CLI arguments: config args + yolo args + model args + prompt args
  // Use yoloArgs from config if available, otherwise default to Claude's --dangerously-skip-permissions
  const yoloArgs = cliConfig.yoloArgs ?? ["--dangerously-skip-permissions"];
  const promptArgs = cliConfig.promptArgs ?? ["-p"];
  const cliArgs = [
    ...(cliConfig.args ?? []),
    ...yoloArgs,
  ];

  // Build the prompt value based on whether fileArgs is configured
  // fileArgs (e.g., ["--read"] for Aider) means files are passed as separate arguments
  // Otherwise, use @file syntax embedded in the prompt (Claude Code style)
  let promptValue: string;
  if (cliConfig.fileArgs && cliConfig.fileArgs.length > 0) {
    // Add files as separate arguments (e.g., --read prd.json --read progress.txt)
    for (const fileArg of cliConfig.fileArgs) {
      cliArgs.push(fileArg, paths.prd);
      cliArgs.push(fileArg, paths.progress);
    }
    promptValue = prompt;
  } else {
    // Use @file syntax embedded in the prompt
    promptValue = `@${paths.prd} @${paths.progress} ${prompt}`;
  }

  // Add stream-json output format if enabled (using provider-specific args)
  let jsonLogPath: string | undefined;
  if (streamJsonEnabled) {
    cliArgs.push(...streamJsonArgs);

    // Setup JSON log file if saving raw JSON
    if (saveRawJson) {
      const fullOutputDir = join(process.cwd(), outputDir);
      if (!existsSync(fullOutputDir)) {
        mkdirSync(fullOutputDir, { recursive: true });
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      jsonLogPath = join(fullOutputDir, `ralph-once-${timestamp}.jsonl`);
    }
  }

  // Add model args if model is specified
  if (model && cliConfig.modelArgs) {
    cliArgs.push(...cliConfig.modelArgs, model);
  }

  cliArgs.push(...promptArgs, promptValue);

  if (debug) {
    console.log(`[debug] ${cliConfig.command} ${cliArgs.map(a => a.includes(" ") ? `"${a}"` : a).join(" ")}\n`);
    if (jsonLogPath) {
      console.log(`[debug] Saving raw JSON to: ${jsonLogPath}\n`);
    }
  }

  // Create provider-specific stream-json parser
  const streamJsonParser = getStreamJsonParser(config.cliProvider, debug);

  // Notification options for this run
  const notifyOptions = { command: config.notifyCommand, debug, daemonConfig: config.daemon };

  return new Promise((resolve, reject) => {
    let output = ""; // Accumulate output for PRD complete detection

    if (streamJsonEnabled) {
      // Stream JSON mode: capture stdout, parse JSON, display clean text
      let lineBuffer = "";

      const proc = spawn(cliConfig.command, cliArgs, {
        stdio: ["inherit", "pipe", "inherit"],
      });

      proc.stdout.on("data", (data: Buffer) => {
        const chunk = data.toString();
        lineBuffer += chunk;
        const lines = lineBuffer.split("\n");
        // Keep the last incomplete line in the buffer
        lineBuffer = lines.pop() || "";

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine) continue;

          // Check if this is a JSON line
          if (trimmedLine.startsWith("{")) {
            // Save raw JSON if enabled
            if (jsonLogPath) {
              try {
                appendFileSync(jsonLogPath, trimmedLine + "\n");
              } catch {
                // Ignore write errors
              }
            }

            // Parse and display clean text using provider-specific parser
            const text = streamJsonParser.parseStreamJsonLine(trimmedLine);
            if (text) {
              process.stdout.write(text);
              output += text; // Accumulate for completion detection
            }
          } else {
            // Non-JSON line - display as-is (might be status messages, errors, etc.)
            process.stdout.write(trimmedLine + "\n");
            output += trimmedLine + "\n";
          }
        }
      });

      proc.on("close", async (code) => {
        // Process any remaining buffered content
        if (lineBuffer.trim()) {
          const trimmedLine = lineBuffer.trim();
          if (trimmedLine.startsWith("{")) {
            if (jsonLogPath) {
              try {
                appendFileSync(jsonLogPath, trimmedLine + "\n");
              } catch {
                // Ignore write errors
              }
            }
            const text = streamJsonParser.parseStreamJsonLine(trimmedLine);
            if (text) {
              process.stdout.write(text);
              output += text;
            }
          } else {
            // Non-JSON remaining content
            process.stdout.write(trimmedLine + "\n");
            output += trimmedLine + "\n";
          }
        }

        // Ensure final newline
        process.stdout.write("\n");

        // Send notification based on outcome
        if (code !== 0) {
          console.error(`\n${cliConfig.command} exited with code ${code}`);
          await sendNotificationWithDaemonEvents("error", `Ralph: Iteration failed with exit code ${code}`, notifyOptions);
        } else if (output.includes("<promise>COMPLETE</promise>")) {
          await sendNotificationWithDaemonEvents("prd_complete", undefined, notifyOptions);
        } else {
          await sendNotificationWithDaemonEvents("iteration_complete", undefined, notifyOptions);
        }

        resolve();
      });

      proc.on("error", (err) => {
        reject(new Error(`Failed to start ${cliConfig.command}: ${err.message}`));
      });
    } else {
      // Standard mode: capture stdout while passing through
      const proc = spawn(cliConfig.command, cliArgs, {
        stdio: ["inherit", "pipe", "inherit"],
      });

      proc.stdout.on("data", (data: Buffer) => {
        const chunk = data.toString();
        output += chunk;
        process.stdout.write(chunk);
      });

      proc.on("close", async (code) => {
        // Send notification based on outcome
        if (code !== 0) {
          console.error(`\n${cliConfig.command} exited with code ${code}`);
          await sendNotificationWithDaemonEvents("error", `Ralph: Iteration failed with exit code ${code}`, notifyOptions);
        } else if (output.includes("<promise>COMPLETE</promise>")) {
          await sendNotificationWithDaemonEvents("prd_complete", undefined, notifyOptions);
        } else {
          await sendNotificationWithDaemonEvents("iteration_complete", undefined, notifyOptions);
        }

        resolve();
      });

      proc.on("error", (err) => {
        reject(new Error(`Failed to start ${cliConfig.command}: ${err.message}`));
      });
    }
  });
}
