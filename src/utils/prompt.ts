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

export async function promptConfirm(message: string): Promise<boolean> {
  const prompt = createPrompt();

  while (true) {
    const answer = await prompt.question(`${message} (y/n): `);
    const normalized = answer.trim().toLowerCase();
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
