import * as readline from "readline";

export function createPrompt(): {
  question: (query: string) => Promise<string>;
  close: () => void;
} {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return {
    question: (query: string) =>
      new Promise((resolve) => {
        rl.question(query, (answer) => {
          resolve(answer);
        });
      }),
    close: () => rl.close(),
  };
}

export async function promptSelectWithArrows(message: string, options: string[]): Promise<string> {
  return new Promise((resolve) => {
    let selectedIndex = 0;

    // Hide cursor and enable raw mode
    process.stdout.write("\x1B[?25l"); // Hide cursor

    const render = () => {
      // Move cursor up to clear previous render (except first time)
      if (selectedIndex >= 0) {
        process.stdout.write(`\x1B[${options.length}A`); // Move up
      }

      options.forEach((opt, i) => {
        const prefix = i === selectedIndex ? "\x1B[36m❯\x1B[0m" : " ";
        const text = i === selectedIndex ? `\x1B[36m${opt}\x1B[0m` : opt;
        process.stdout.write(`\x1B[2K${prefix} ${text}\n`); // Clear line and write
      });
    };

    const initialRender = () => {
      console.log(`\n${message}\n`);
      options.forEach((opt, i) => {
        const prefix = i === selectedIndex ? "\x1B[36m❯\x1B[0m" : " ";
        const text = i === selectedIndex ? `\x1B[36m${opt}\x1B[0m` : opt;
        console.log(`${prefix} ${text}`);
      });
    };

    initialRender();

    // Set up raw mode for key input
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    const onKeypress = (key: string) => {
      // Handle arrow keys (escape sequences)
      if (key === "\x1B[A" || key === "k") { // Up arrow or k
        selectedIndex = (selectedIndex - 1 + options.length) % options.length;
        render();
      } else if (key === "\x1B[B" || key === "j") { // Down arrow or j
        selectedIndex = (selectedIndex + 1) % options.length;
        render();
      } else if (key === "\r" || key === "\n" || key === " ") { // Enter or space
        cleanup();
        resolve(options[selectedIndex]);
      } else if (key === "\x03") { // Ctrl+C
        cleanup();
        process.exit(0);
      }
    };

    const cleanup = () => {
      process.stdin.removeListener("data", onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
      process.stdout.write("\x1B[?25h"); // Show cursor
    };

    process.stdin.on("data", onKeypress);
  });
}

export async function promptInput(message: string): Promise<string> {
  const prompt = createPrompt();
  const answer = await prompt.question(message);
  prompt.close();
  return answer.trim();
}

export async function promptSelect(message: string, options: string[]): Promise<string> {
  console.log(`\n${message}`);
  options.forEach((opt, i) => {
    console.log(`  ${i + 1}. ${opt}`);
  });

  const prompt = createPrompt();

  while (true) {
    const answer = await prompt.question("\nEnter number: ");
    const num = parseInt(answer.trim());
    if (num >= 1 && num <= options.length) {
      prompt.close();
      return options[num - 1];
    }
    console.log("Invalid selection.");
  }
}

export async function promptConfirm(message: string, defaultValue: boolean = true): Promise<boolean> {
  const prompt = createPrompt();
  const hint = defaultValue ? "(Y/n)" : "(y/N)";

  while (true) {
    const answer = await prompt.question(`${message} ${hint}: `);
    const normalized = answer.trim().toLowerCase();

    // Empty input returns default
    if (normalized === "") {
      prompt.close();
      return defaultValue;
    }
    if (normalized === "y" || normalized === "yes") {
      prompt.close();
      return true;
    }
    if (normalized === "n" || normalized === "no") {
      prompt.close();
      return false;
    }
    console.log("Please enter y or n.");
  }
}

export async function promptMultiSelect(message: string, options: string[]): Promise<string[]> {
  console.log(`\n${message}`);
  options.forEach((opt, i) => {
    console.log(`  ${i + 1}. ${opt}`);
  });
  console.log(`  0. [Done selecting]`);

  const prompt = createPrompt();
  const selected: string[] = [];
  const customTechs: string[] = [];

  console.log("\nEnter a number to select, or type text to add custom technology (0 when done):");

  while (true) {
    const answer = await prompt.question("> ");
    const trimmed = answer.trim();

    if (trimmed === "0") {
      prompt.close();
      return [...selected, ...customTechs];
    }

    if (trimmed === "") {
      continue;
    }

    const num = parseInt(trimmed);

    // Check if input is a valid number selection
    if (!isNaN(num) && num >= 1 && num <= options.length) {
      const selectedOption = options[num - 1];
      if (!selected.includes(selectedOption)) {
        selected.push(selectedOption);
        console.log(`Selected: ${selectedOption}`);
      } else {
        console.log(`Already selected: ${selectedOption}`);
      }
    } else if (!isNaN(num)) {
      // Invalid number
      console.log(`Invalid number. Enter 1-${options.length}, or type text for custom technology.`);
    } else {
      // Text input - treat as custom technology
      if (!customTechs.includes(trimmed) && !selected.some(s => s.toLowerCase().includes(trimmed.toLowerCase()))) {
        customTechs.push(trimmed);
        console.log(`Added custom: ${trimmed}`);
      } else {
        console.log(`Already added: ${trimmed}`);
      }
    }
  }
}

export async function promptMultiSelectWithArrows(message: string, options: string[]): Promise<string[]> {
  return new Promise((resolve) => {
    let selectedIndex = 0;
    const selected: Set<number> = new Set();

    // Add a "Done" option at the end
    const allOptions = [...options, "[Done - press Enter]"];

    // Hide cursor
    process.stdout.write("\x1B[?25l");

    const render = () => {
      process.stdout.write(`\x1B[${allOptions.length}A`); // Move up

      allOptions.forEach((opt, i) => {
        const isLastOption = i === allOptions.length - 1;
        const cursor = i === selectedIndex ? "\x1B[36m❯\x1B[0m" : " ";
        const checkbox = isLastOption ? "" : (selected.has(i) ? "\x1B[32m[x]\x1B[0m" : "[ ]");
        const text = i === selectedIndex ? `\x1B[36m${opt}\x1B[0m` : opt;
        process.stdout.write(`\x1B[2K${cursor} ${checkbox} ${text}\n`);
      });
    };

    const initialRender = () => {
      console.log(`\n${message}`);
      console.log("(Use arrow keys to navigate, Space to select, Enter to confirm)\n");
      allOptions.forEach((opt, i) => {
        const isLastOption = i === allOptions.length - 1;
        const cursor = i === selectedIndex ? "\x1B[36m❯\x1B[0m" : " ";
        const checkbox = isLastOption ? "" : (selected.has(i) ? "\x1B[32m[x]\x1B[0m" : "[ ]");
        const text = i === selectedIndex ? `\x1B[36m${opt}\x1B[0m` : opt;
        console.log(`${cursor} ${checkbox} ${text}`);
      });
    };

    initialRender();

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    const onKeypress = (key: string) => {
      if (key === "\x1B[A" || key === "k") { // Up
        selectedIndex = (selectedIndex - 1 + allOptions.length) % allOptions.length;
        render();
      } else if (key === "\x1B[B" || key === "j") { // Down
        selectedIndex = (selectedIndex + 1) % allOptions.length;
        render();
      } else if (key === " ") { // Space - toggle selection
        const isLastOption = selectedIndex === allOptions.length - 1;
        if (!isLastOption) {
          if (selected.has(selectedIndex)) {
            selected.delete(selectedIndex);
          } else {
            selected.add(selectedIndex);
          }
          render();
        }
      } else if (key === "\r" || key === "\n") { // Enter - confirm
        cleanup();
        const result = options.filter((_, i) => selected.has(i));
        resolve(result);
      } else if (key === "\x03") { // Ctrl+C
        cleanup();
        process.exit(0);
      }
    };

    const cleanup = () => {
      process.stdin.removeListener("data", onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdin.pause();
      process.stdout.write("\x1B[?25h"); // Show cursor
    };

    process.stdin.on("data", onKeypress);
  });
}
