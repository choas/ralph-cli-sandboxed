import { useState, useCallback, useEffect } from "react";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { RalphConfig, getPaths } from "../../utils/config.js";

export interface UseConfigResult {
  config: RalphConfig | null;
  loading: boolean;
  error: string | null;
  hasChanges: boolean;
  loadConfig: () => void;
  saveConfig: () => boolean;
  updateConfig: (updater: (config: RalphConfig) => RalphConfig) => void;
  resetChanges: () => void;
}

/**
 * React hook for loading and saving ralph configuration.
 * Provides state management for the config editor with dirty state tracking.
 */
export function useConfig(): UseConfigResult {
  const [config, setConfig] = useState<RalphConfig | null>(null);
  const [originalConfig, setOriginalConfig] = useState<RalphConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  const loadConfigFromFile = useCallback(() => {
    setLoading(true);
    setError(null);

    try {
      const paths = getPaths();

      if (!existsSync(paths.config)) {
        throw new Error(".ralph/config.json not found. Run 'ralph init' first.");
      }

      const content = readFileSync(paths.config, "utf-8");
      const parsedConfig = JSON.parse(content) as RalphConfig;

      setConfig(parsedConfig);
      setOriginalConfig(JSON.parse(content) as RalphConfig); // Deep copy for comparison
      setHasChanges(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error loading config";
      setError(message);
      setConfig(null);
      setOriginalConfig(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const saveConfig = useCallback((): boolean => {
    if (!config) {
      setError("No config to save");
      return false;
    }

    try {
      const paths = getPaths();
      const jsonContent = JSON.stringify(config, null, 2);
      writeFileSync(paths.config, jsonContent, "utf-8");

      // Update original config after successful save
      setOriginalConfig(JSON.parse(jsonContent) as RalphConfig);
      setHasChanges(false);
      setError(null);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error saving config";
      setError(message);
      return false;
    }
  }, [config]);

  const updateConfig = useCallback((updater: (config: RalphConfig) => RalphConfig) => {
    setConfig((currentConfig) => {
      if (!currentConfig) return null;
      const newConfig = updater(currentConfig);
      return newConfig;
    });
    setHasChanges(true);
  }, []);

  const resetChanges = useCallback(() => {
    if (originalConfig) {
      // Deep copy to avoid reference issues
      setConfig(JSON.parse(JSON.stringify(originalConfig)) as RalphConfig);
      setHasChanges(false);
    }
  }, [originalConfig]);

  // Load config on mount
  useEffect(() => {
    loadConfigFromFile();
  }, [loadConfigFromFile]);

  return {
    config,
    loading,
    error,
    hasChanges,
    loadConfig: loadConfigFromFile,
    saveConfig,
    updateConfig,
    resetChanges,
  };
}
