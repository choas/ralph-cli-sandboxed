import { useEffect, useState } from "react";
import { useStdout } from "ink";

export interface TerminalSize {
  columns: number;
  rows: number;
}

export const DEFAULT_TERMINAL_SIZE: TerminalSize = {
  columns: 80,
  rows: 24,
};

export const MIN_TERMINAL_SIZE: TerminalSize = {
  columns: 60,
  rows: 16,
};

export function useTerminalSize(): TerminalSize {
  const { stdout } = useStdout();
  const [size, setSize] = useState<TerminalSize>(() => ({
    columns: stdout?.columns ?? DEFAULT_TERMINAL_SIZE.columns,
    rows: stdout?.rows ?? DEFAULT_TERMINAL_SIZE.rows,
  }));

  useEffect(() => {
    if (!stdout) return;
    const onResize = () => {
      setSize({
        columns: stdout.columns,
        rows: stdout.rows,
      });
    };
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  return {
    columns: Math.max(size.columns, MIN_TERMINAL_SIZE.columns),
    rows: Math.max(size.rows, MIN_TERMINAL_SIZE.rows),
  };
}

export default useTerminalSize;
