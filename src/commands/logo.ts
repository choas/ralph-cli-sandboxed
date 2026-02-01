/**
 * Hidden command to display the Ralph CLI ASCII art logo.
 * Easter egg - not shown in help.
 */

// Yellow gradient colors (Ralph Wiggum style)
const GRADIENT = [
  "\x1b[38;2;255;245;157m", // #FFF59D - pale yellow
  "\x1b[38;2;255;238;88m", // #FFEE58 - light yellow
  "\x1b[38;2;255;235;59m", // #FFEB3B - Simpsons yellow
  "\x1b[38;2;253;216;53m", // #FDD835 - medium yellow
  "\x1b[38;2;251;192;45m", // #FBC02D - golden yellow
  "\x1b[38;2;249;168;37m", // #F9A825 - deep gold
];

const RESET = "\x1b[0m";
const GRAY = "\x1b[38;5;248m";

const LOGO_LINES = [
  "██████╗  █████╗ ██╗     ██████╗ ██╗  ██╗     ██████╗██╗     ██╗",
  "██╔══██╗██╔══██╗██║     ██╔══██╗██║  ██║    ██╔════╝██║     ██║",
  "██████╔╝███████║██║     ██████╔╝███████║    ██║     ██║     ██║",
  "██╔══██╗██╔══██║██║     ██╔═══╝ ██╔══██║    ██║     ██║     ██║",
  "██║  ██║██║  ██║███████╗██║     ██║  ██║    ╚██████╗███████╗██║",
  "╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝  ╚═╝     ╚═════╝╚══════╝╚═╝",
];

export async function logo(): Promise<void> {
  console.log("");

  for (let i = 0; i < LOGO_LINES.length; i++) {
    const color = GRADIENT[i] || GRADIENT[GRADIENT.length - 1];
    // Add "sandboxed" in yellow on line 3 (index 2)
    const suffix = i === 2 ? `  ${GRADIENT[i]}sandboxed${RESET}` : "";
    console.log(`${color}${LOGO_LINES[i]}${RESET}${suffix}`);
  }

  // Get version
  try {
    const pkg = await import("../../package.json", { with: { type: "json" } });
    console.log(`${GRAY}v${pkg.default.version}${RESET}`);
  } catch {
    console.log(`${GRAY}ralph-cli${RESET}`);
  }

  console.log("");
}
