import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { type ResponderConfig, type RespondersConfig } from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to the presets file (relative to dist/utils when compiled)
const PRESETS_FILE = join(__dirname, "..", "config", "responder-presets.json");

/**
 * Preset responder configuration from the JSON file.
 */
export interface ResponderPreset {
  name: string;
  description: string;
  type: "llm" | "claude-code" | "cli";
  trigger?: string;
  provider?: string;
  systemPrompt?: string;
  command?: string;
  timeout?: number;
  maxLength?: number;
}

/**
 * Bundle of presets for quick setup.
 */
export interface ResponderBundle {
  name: string;
  description: string;
  presets: string[];
}

/**
 * Full presets configuration from the JSON file.
 */
export interface ResponderPresetsConfig {
  presets: Record<string, ResponderPreset>;
  bundles: Record<string, ResponderBundle>;
}

/**
 * Load responder presets from the configuration file.
 */
export function loadResponderPresets(): ResponderPresetsConfig {
  try {
    const content = readFileSync(PRESETS_FILE, "utf-8");
    return JSON.parse(content) as ResponderPresetsConfig;
  } catch (error) {
    console.error(`Failed to load responder presets: ${error}`);
    return { presets: {}, bundles: {} };
  }
}

/**
 * Get a single preset by ID.
 */
export function getResponderPreset(presetId: string): ResponderPreset | undefined {
  const config = loadResponderPresets();
  return config.presets[presetId];
}

/**
 * Get all available preset IDs.
 */
export function getResponderPresetIds(): string[] {
  const config = loadResponderPresets();
  return Object.keys(config.presets);
}

/**
 * Get all available presets with their metadata.
 */
export function getResponderPresetList(): Array<{ id: string } & ResponderPreset> {
  const config = loadResponderPresets();
  return Object.entries(config.presets).map(([id, preset]) => ({
    id,
    ...preset,
  }));
}

/**
 * Get all available bundles.
 */
export function getResponderBundles(): Record<string, ResponderBundle> {
  const config = loadResponderPresets();
  return config.bundles;
}

/**
 * Get a single bundle by ID.
 */
export function getResponderBundle(bundleId: string): ResponderBundle | undefined {
  const config = loadResponderPresets();
  return config.bundles[bundleId];
}

/**
 * Get all available bundle IDs.
 */
export function getResponderBundleIds(): string[] {
  const config = loadResponderPresets();
  return Object.keys(config.bundles);
}

/**
 * Convert a preset to a ResponderConfig for use in config.json.
 * Strips the name and description fields that are only for display.
 */
export function presetToResponderConfig(preset: ResponderPreset): ResponderConfig {
  const config: ResponderConfig = {
    type: preset.type,
  };

  if (preset.trigger) config.trigger = preset.trigger;
  if (preset.provider) config.provider = preset.provider;
  if (preset.systemPrompt) config.systemPrompt = preset.systemPrompt;
  if (preset.command) config.command = preset.command;
  if (preset.timeout) config.timeout = preset.timeout;
  if (preset.maxLength) config.maxLength = preset.maxLength;

  return config;
}

/**
 * Convert multiple preset IDs to a RespondersConfig object.
 * Uses the preset ID as the responder name.
 */
export function presetsToRespondersConfig(presetIds: string[]): RespondersConfig {
  const config = loadResponderPresets();
  const responders: RespondersConfig = {};

  for (const id of presetIds) {
    const preset = config.presets[id];
    if (preset) {
      responders[id] = presetToResponderConfig(preset);
    }
  }

  return responders;
}

/**
 * Convert a bundle to a RespondersConfig object.
 */
export function bundleToRespondersConfig(bundleId: string): RespondersConfig {
  const config = loadResponderPresets();
  const bundle = config.bundles[bundleId];

  if (!bundle) {
    return {};
  }

  return presetsToRespondersConfig(bundle.presets);
}

/**
 * Get display options for preset selection in CLI prompts.
 * Returns array of "name - description" strings for display.
 */
export function getPresetDisplayOptions(): string[] {
  const presets = getResponderPresetList();
  return presets.map((p) => `${p.name} - ${p.description}`);
}

/**
 * Get display options for bundle selection in CLI prompts.
 * Returns array of "name - description (preset1, preset2, ...)" strings for display.
 */
export function getBundleDisplayOptions(): string[] {
  const config = loadResponderPresets();
  return Object.entries(config.bundles).map(([, bundle]) => {
    const presetNames = bundle.presets.join(", ");
    return `${bundle.name} - ${bundle.description} (${presetNames})`;
  });
}

/**
 * Map bundle display option back to bundle ID.
 */
export function displayOptionToBundleId(displayOption: string): string | undefined {
  const config = loadResponderPresets();
  for (const [id, bundle] of Object.entries(config.bundles)) {
    if (displayOption.startsWith(bundle.name)) {
      return id;
    }
  }
  return undefined;
}

/**
 * Map preset display option back to preset ID.
 */
export function displayOptionToPresetId(displayOption: string): string | undefined {
  const config = loadResponderPresets();
  for (const [id, preset] of Object.entries(config.presets)) {
    if (displayOption.startsWith(preset.name)) {
      return id;
    }
  }
  return undefined;
}
