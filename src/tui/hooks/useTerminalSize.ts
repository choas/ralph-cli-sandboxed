import { useState, useEffect } from "react";
import { useStdout } from "ink";

/**
 * Terminal size dimensions.
 */
export interface TerminalSize {
  columns: number;
  rows: number;
}

/**
 * Default terminal size (standard VT100 terminal dimensions).
 */
export const DEFAULT_TERMINAL_SIZE: TerminalSize = {
  columns: 80,
  rows: 24,
};

/**
 * Minimum terminal size for the config editor.
 */
export const MIN_TERMINAL_SIZE: TerminalSize = {
  columns: 60,
  rows: 16,
};

/**
 * Hook that returns the current terminal size and updates on resize.
 * Falls back to default dimensions if terminal size cannot be determined.
 */
export function useTerminalSize(): TerminalSize {
  const { stdout } = useStdout();

  const getSize = (): TerminalSize => {
    if (stdout && typeof stdout.columns === "number" && typeof stdout.rows === "number") {
      return {
        columns: Math.max(stdout.columns, MIN_TERMINAL_SIZE.columns),
        rows: Math.max(stdout.rows, MIN_TERMINAL_SIZE.rows),
      };
    }
    return DEFAULT_TERMINAL_SIZE;
  };

  const [size, setSize] = useState<TerminalSize>(getSize);

  useEffect(() => {
    const handleResize = () => {
      setSize(getSize());
    };

    // Listen for terminal resize events
    if (stdout && typeof stdout.on === "function") {
      stdout.on("resize", handleResize);
      return () => {
        stdout.off("resize", handleResize);
      };
    }

    return undefined;
  }, [stdout]);

  return size;
}

export default useTerminalSize;
