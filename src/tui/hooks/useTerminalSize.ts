import { useWindowSize } from "ink";

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
  const { columns, rows } = useWindowSize();
  return {
    columns: Math.max(columns, MIN_TERMINAL_SIZE.columns),
    rows: Math.max(rows, MIN_TERMINAL_SIZE.rows),
  };
}

export default useTerminalSize;
