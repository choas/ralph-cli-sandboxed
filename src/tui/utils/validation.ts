import type { RalphConfig } from "../../utils/config.js";

/**
 * Validation error for a specific field.
 */
export interface ValidationError {
  field: string; // Dot notation path: "language", "docker.ports[0]"
  message: string; // Human readable error
  type: "required" | "format" | "pattern";
}

/**
 * Result of validating a configuration.
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Required fields that cannot be empty.
 */
const REQUIRED_FIELDS = ["language", "checkCommand", "testCommand"] as const;

/**
 * Port format pattern: host_port:container_port (e.g., "3000:3000", "8080:80")
 */
const PORT_PATTERN = /^\d+:\d+$/;

/**
 * Get a value at a dot-notation path from an object.
 */
function getValueAtPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * Validate that a port string matches the expected format.
 * @param port - Port mapping string (e.g., "3000:3000")
 * @returns true if valid, false otherwise
 */
export function validatePortFormat(port: string): boolean {
  return PORT_PATTERN.test(port);
}

/**
 * Check if a required field has a valid non-empty value.
 * @param value - The field value to check
 * @returns true if valid, false otherwise
 */
export function isRequiredFieldValid(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return true;
}

/**
 * Convert a field path to a human-readable label.
 */
function pathToLabel(path: string): string {
  const parts = path.split(".");
  const lastPart = parts[parts.length - 1];
  return lastPart
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}

/**
 * Validate required fields in the configuration.
 */
function validateRequiredFields(config: RalphConfig): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const field of REQUIRED_FIELDS) {
    const value = getValueAtPath(config, field);
    if (!isRequiredFieldValid(value)) {
      errors.push({
        field,
        message: `${pathToLabel(field)} is required and cannot be empty`,
        type: "required",
      });
    }
  }

  return errors;
}

/**
 * Validate port format for all docker ports.
 */
function validateDockerPorts(config: RalphConfig): ValidationError[] {
  const errors: ValidationError[] = [];
  const ports = config.docker?.ports;

  if (!ports || !Array.isArray(ports)) {
    return errors;
  }

  for (let i = 0; i < ports.length; i++) {
    const port = ports[i];
    if (typeof port === "string" && !validatePortFormat(port)) {
      errors.push({
        field: `docker.ports[${i}]`,
        message: `Invalid port format: "${port}". Expected format: "host:container" (e.g., "3000:3000")`,
        type: "pattern",
      });
    }
  }

  return errors;
}

/**
 * Required keys for each notification provider.
 */
const NOTIFICATION_PROVIDER_REQUIRED_KEYS: Record<string, string[]> = {
  ntfy: ["topic"],
  pushover: ["user", "token"],
  gotify: ["server", "token"],
};

/**
 * Validate notification provider configuration.
 * Checks that required keys are present for the selected provider.
 */
function validateNotificationProvider(config: RalphConfig): ValidationError[] {
  const errors: ValidationError[] = [];
  const notifications = config.notifications;

  if (!notifications || !notifications.provider) {
    return errors;
  }

  const provider = notifications.provider;

  // Skip validation for command provider (uses command string instead of key-value)
  if (provider === "command") {
    return errors;
  }

  const requiredKeys = NOTIFICATION_PROVIDER_REQUIRED_KEYS[provider];
  if (!requiredKeys) {
    return errors;
  }

  const providerConfig = notifications[provider as keyof typeof notifications];
  if (!providerConfig || typeof providerConfig !== "object") {
    // Provider config is missing entirely
    for (const key of requiredKeys) {
      errors.push({
        field: `notifications.${provider}.${key}`,
        message: `${key} is required for ${provider} provider`,
        type: "required",
      });
    }
    return errors;
  }

  // Check each required key
  const configObj = providerConfig as Record<string, unknown>;
  for (const key of requiredKeys) {
    const value = configObj[key];
    if (!isRequiredFieldValid(value)) {
      errors.push({
        field: `notifications.${provider}.${key}`,
        message: `${key} is required for ${provider} provider`,
        type: "required",
      });
    }
  }

  return errors;
}

/**
 * Validate the entire configuration.
 * @param config - The configuration to validate
 * @returns ValidationResult with valid flag and any errors found
 */
export function validateConfig(config: RalphConfig): ValidationResult {
  const errors: ValidationError[] = [];

  // Check required fields
  errors.push(...validateRequiredFields(config));

  // Check docker port format
  errors.push(...validateDockerPorts(config));

  // Check notification provider required keys
  errors.push(...validateNotificationProvider(config));

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get validation errors for a specific field path.
 * Useful for inline error display in the editor.
 * @param errors - List of all validation errors
 * @param fieldPath - The field path to check (e.g., "language", "docker.ports")
 * @returns Array of errors matching the field path
 */
export function getFieldErrors(errors: ValidationError[], fieldPath: string): ValidationError[] {
  return errors.filter((error) => {
    // Exact match
    if (error.field === fieldPath) {
      return true;
    }
    // Array field match (e.g., "docker.ports" matches "docker.ports[0]")
    if (error.field.startsWith(fieldPath + "[")) {
      return true;
    }
    return false;
  });
}

/**
 * Check if a field has any validation errors.
 * @param errors - List of all validation errors
 * @param fieldPath - The field path to check
 * @returns true if the field has errors, false otherwise
 */
export function hasFieldError(errors: ValidationError[], fieldPath: string): boolean {
  return getFieldErrors(errors, fieldPath).length > 0;
}
