import { describe, it, expect } from "vitest";
import {
  validatePrd,
  extractPassingItems,
  smartMerge,
  attemptRecovery,
  robustYamlParse,
  expandFileReferences,
  expandPrdFileReferences,
  createTemplatePrd,
  type PrdEntry,
} from "./prd-validator.js";

// ─── validatePrd ────────────────────────────────────────────────────

describe("validatePrd", () => {
  it("validates a correct PRD array", () => {
    const prd = [
      {
        category: "feature",
        description: "Add login page",
        steps: ["Create form", "Add validation"],
        passes: false,
      },
    ];
    const result = validatePrd(prd);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.data).toHaveLength(1);
    expect(result.data![0].category).toBe("feature");
  });

  it("rejects non-array input", () => {
    const result = validatePrd({ not: "an array" });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("PRD must be a JSON array");
  });

  it("rejects items with missing fields", () => {
    const result = validatePrd([{ category: "feature" }]);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects invalid categories", () => {
    const result = validatePrd([
      {
        category: "invalid-cat",
        description: "test",
        steps: ["step1"],
        passes: false,
      },
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("invalid category"))).toBe(true);
  });

  it("rejects non-string steps", () => {
    const result = validatePrd([
      {
        category: "feature",
        description: "test",
        steps: [123],
        passes: false,
      },
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("step 1 must be a string"))).toBe(true);
  });

  it("rejects non-boolean passes", () => {
    const result = validatePrd([
      {
        category: "feature",
        description: "test",
        steps: ["step"],
        passes: "yes",
      },
    ]);
    expect(result.valid).toBe(false);
  });

  it("accepts optional branch field", () => {
    const result = validatePrd([
      {
        category: "feature",
        description: "test",
        steps: ["step"],
        passes: false,
        branch: "feat/login",
      },
    ]);
    expect(result.valid).toBe(true);
    expect(result.data![0].branch).toBe("feat/login");
  });

  it("rejects non-string branch field", () => {
    const result = validatePrd([
      {
        category: "feature",
        description: "test",
        steps: ["step"],
        passes: false,
        branch: 123,
      },
    ]);
    expect(result.valid).toBe(false);
  });

  it("rejects non-object items", () => {
    const result = validatePrd(["not an object"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("must be an object"))).toBe(true);
  });

  it("rejects empty description", () => {
    const result = validatePrd([
      {
        category: "feature",
        description: "",
        steps: ["step"],
        passes: false,
      },
    ]);
    expect(result.valid).toBe(false);
  });

  // --- new edge case tests ---

  it("validates an empty array as valid", () => {
    const result = validatePrd([]);
    expect(result.valid).toBe(true);
    expect(result.data).toEqual([]);
  });

  it("accepts all valid category values", () => {
    const categories = ["ui", "feature", "bugfix", "setup", "development", "testing", "docs"];
    for (const category of categories) {
      const result = validatePrd([
        { category, description: `Test ${category}`, steps: ["step"], passes: false },
      ]);
      expect(result.valid).toBe(true);
      expect(result.data![0].category).toBe(category);
    }
  });

  it("validates multiple valid items", () => {
    const prd = [
      { category: "feature", description: "First", steps: ["a"], passes: false },
      { category: "bugfix", description: "Second", steps: ["b", "c"], passes: true },
      { category: "docs", description: "Third", steps: ["d"], passes: false, branch: "docs/api" },
    ];
    const result = validatePrd(prd);
    expect(result.valid).toBe(true);
    expect(result.data).toHaveLength(3);
    expect(result.data![1].passes).toBe(true);
    expect(result.data![2].branch).toBe("docs/api");
  });

  it("collects errors from multiple invalid items", () => {
    const result = validatePrd([
      { category: "badcat", description: "a", steps: ["s"], passes: false },
      { category: "feature", description: "", steps: ["s"], passes: false },
      { category: "feature", description: "x", steps: "not-array", passes: false },
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects null items in array", () => {
    const result = validatePrd([null]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("must be an object"))).toBe(true);
  });

  it("rejects number items in array", () => {
    const result = validatePrd([42]);
    expect(result.valid).toBe(false);
  });

  it("rejects boolean items in array", () => {
    const result = validatePrd([true]);
    expect(result.valid).toBe(false);
  });

  it("rejects steps that is not an array", () => {
    const result = validatePrd([
      { category: "feature", description: "test", steps: "just a string", passes: false },
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("steps"))).toBe(true);
  });

  it("rejects missing category entirely", () => {
    const result = validatePrd([{ description: "test", steps: ["step"], passes: false }]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("category"))).toBe(true);
  });

  it("rejects passes as numeric", () => {
    const result = validatePrd([
      { category: "feature", description: "test", steps: ["step"], passes: 1 },
    ]);
    expect(result.valid).toBe(false);
  });

  it("does not include branch in data when not provided", () => {
    const result = validatePrd([
      { category: "feature", description: "test", steps: ["step"], passes: false },
    ]);
    expect(result.valid).toBe(true);
    expect(result.data![0].branch).toBeUndefined();
  });

  it("rejects string input", () => {
    const result = validatePrd("not an array");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("PRD must be a JSON array");
  });

  it("rejects null input", () => {
    const result = validatePrd(null);
    expect(result.valid).toBe(false);
  });

  it("rejects undefined input", () => {
    const result = validatePrd(undefined);
    expect(result.valid).toBe(false);
  });

  it("rejects numeric input", () => {
    const result = validatePrd(123);
    expect(result.valid).toBe(false);
  });

  it("handles steps with mixed valid and invalid entries", () => {
    const result = validatePrd([
      {
        category: "feature",
        description: "test",
        steps: ["valid", 123, "also valid"],
        passes: false,
      },
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("step 2 must be a string"))).toBe(true);
  });

  it("allows items with passes: true", () => {
    const result = validatePrd([
      { category: "feature", description: "Completed feature", steps: ["done"], passes: true },
    ]);
    expect(result.valid).toBe(true);
    expect(result.data![0].passes).toBe(true);
  });

  it("accepts items with empty steps array", () => {
    const result = validatePrd([
      { category: "feature", description: "test", steps: [], passes: false },
    ]);
    expect(result.valid).toBe(true);
    expect(result.data![0].steps).toEqual([]);
  });

  it("handles branch field with empty string", () => {
    const result = validatePrd([
      { category: "feature", description: "test", steps: ["s"], passes: false, branch: "" },
    ]);
    // empty string is still a string, should be valid
    expect(result.valid).toBe(true);
  });

  it("rejects branch as boolean", () => {
    const result = validatePrd([
      { category: "feature", description: "test", steps: ["s"], passes: false, branch: true },
    ]);
    expect(result.valid).toBe(false);
  });

  it("rejects branch as array", () => {
    const result = validatePrd([
      { category: "feature", description: "test", steps: ["s"], passes: false, branch: ["a", "b"] },
    ]);
    expect(result.valid).toBe(false);
  });
});

// ─── extractPassingItems ────────────────────────────────────────────

describe("extractPassingItems", () => {
  it("returns empty for null/undefined", () => {
    expect(extractPassingItems(null)).toEqual([]);
    expect(extractPassingItems(undefined)).toEqual([]);
  });

  it("extracts from a direct array", () => {
    const items = extractPassingItems([
      { description: "Login page", passes: true },
      { description: "Signup page", passes: false },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0].description).toBe("Login page");
    expect(items[0].passes).toBe(true);
    expect(items[1].passes).toBe(false);
  });

  it("extracts from wrapped objects", () => {
    const items = extractPassingItems({
      tasks: [{ description: "Login page", passes: true }],
    });
    expect(items).toHaveLength(1);
    expect(items[0].description).toBe("Login page");
  });

  it("handles alternative field names", () => {
    const items = extractPassingItems([{ name: "Login page", done: true }]);
    expect(items).toHaveLength(1);
    expect(items[0].description).toBe("Login page");
    expect(items[0].passes).toBe(true);
  });

  it("handles string passes values", () => {
    const items = extractPassingItems([
      { description: "Task A", status: "completed" },
      { description: "Task B", status: "pending" },
    ]);
    expect(items[0].passes).toBe(true);
    expect(items[1].passes).toBe(false);
  });

  it("extracts from a single object (not array)", () => {
    const items = extractPassingItems({ title: "Single task", passes: true });
    expect(items).toHaveLength(1);
    expect(items[0].description).toBe("Single task");
  });

  it("skips items without description", () => {
    const items = extractPassingItems([{ passes: true }, { description: "Valid", passes: true }]);
    expect(items).toHaveLength(1);
    expect(items[0].description).toBe("Valid");
  });

  // --- new edge case tests ---

  it("returns empty for empty array", () => {
    expect(extractPassingItems([])).toEqual([]);
  });

  it("returns empty for empty object", () => {
    expect(extractPassingItems({})).toEqual([]);
  });

  it("returns empty for primitive values", () => {
    expect(extractPassingItems(42)).toEqual([]);
    expect(extractPassingItems("string")).toEqual([]);
    expect(extractPassingItems(true)).toEqual([]);
  });

  it("extracts from 'features' wrapper key", () => {
    const items = extractPassingItems({
      features: [{ description: "Feature 1", passes: true }],
    });
    expect(items).toHaveLength(1);
    expect(items[0].description).toBe("Feature 1");
  });

  it("extracts from 'items' wrapper key", () => {
    const items = extractPassingItems({
      items: [{ description: "Item 1", passes: false }],
    });
    expect(items).toHaveLength(1);
    expect(items[0].passes).toBe(false);
  });

  it("extracts from 'entries' wrapper key", () => {
    const items = extractPassingItems({
      entries: [{ description: "Entry 1", done: true }],
    });
    expect(items).toHaveLength(1);
    expect(items[0].passes).toBe(true);
  });

  it("extracts from 'prd' wrapper key", () => {
    const items = extractPassingItems({
      prd: [{ description: "PRD item", passes: true }],
    });
    expect(items).toHaveLength(1);
  });

  it("extracts from 'requirements' wrapper key", () => {
    const items = extractPassingItems({
      requirements: [{ description: "Requirement 1", complete: true }],
    });
    expect(items).toHaveLength(1);
    expect(items[0].passes).toBe(true);
  });

  it("uses first matching wrapper key and ignores others", () => {
    const items = extractPassingItems({
      features: [{ description: "From features", passes: true }],
      tasks: [{ description: "From tasks", passes: false }],
    });
    expect(items).toHaveLength(1);
    expect(items[0].description).toBe("From features");
  });

  it("handles 'desc' as alternative description field", () => {
    const items = extractPassingItems([{ desc: "Short desc", passes: true }]);
    expect(items).toHaveLength(1);
    expect(items[0].description).toBe("Short desc");
  });

  it("handles 'task' as alternative description field", () => {
    const items = extractPassingItems([{ task: "My task", passes: false }]);
    expect(items).toHaveLength(1);
    expect(items[0].description).toBe("My task");
  });

  it("handles 'feature' as alternative description field", () => {
    const items = extractPassingItems([{ feature: "My feature", passes: true }]);
    expect(items).toHaveLength(1);
    expect(items[0].description).toBe("My feature");
  });

  it("handles 'pass' as alternative passes field", () => {
    const items = extractPassingItems([{ description: "test", pass: true }]);
    expect(items).toHaveLength(1);
    expect(items[0].passes).toBe(true);
  });

  it("handles 'passed' as alternative passes field", () => {
    const items = extractPassingItems([{ description: "test", passed: true }]);
    expect(items).toHaveLength(1);
    expect(items[0].passes).toBe(true);
  });

  it("handles 'finished' as alternative passes field", () => {
    const items = extractPassingItems([{ description: "test", finished: true }]);
    expect(items).toHaveLength(1);
    expect(items[0].passes).toBe(true);
  });

  it("handles string status 'true'", () => {
    const items = extractPassingItems([{ description: "test", passes: "true" }]);
    expect(items).toHaveLength(1);
    expect(items[0].passes).toBe(true);
  });

  it("handles string status 'pass'", () => {
    const items = extractPassingItems([{ description: "test", status: "pass" }]);
    expect(items).toHaveLength(1);
    expect(items[0].passes).toBe(true);
  });

  it("handles string status 'passed'", () => {
    const items = extractPassingItems([{ description: "test", status: "passed" }]);
    expect(items).toHaveLength(1);
    expect(items[0].passes).toBe(true);
  });

  it("handles string status 'done'", () => {
    const items = extractPassingItems([{ description: "test", status: "done" }]);
    expect(items).toHaveLength(1);
    expect(items[0].passes).toBe(true);
  });

  it("handles string status 'finished'", () => {
    const items = extractPassingItems([{ description: "test", status: "finished" }]);
    expect(items).toHaveLength(1);
    expect(items[0].passes).toBe(true);
  });

  it("defaults passes to false when no passes field found", () => {
    const items = extractPassingItems([{ description: "test" }]);
    expect(items).toHaveLength(1);
    expect(items[0].passes).toBe(false);
  });

  it("prefers 'description' over alternative field names", () => {
    const items = extractPassingItems([
      { description: "Primary", name: "Secondary", title: "Tertiary", passes: true },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].description).toBe("Primary");
  });

  it("skips non-object items in array", () => {
    const items = extractPassingItems([
      "string item",
      42,
      null,
      { description: "Valid item", passes: true },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].description).toBe("Valid item");
  });

  it("handles object with non-array wrapper value", () => {
    const items = extractPassingItems({
      tasks: "not an array",
      description: "Fallback item",
      passes: true,
    });
    // Falls through all wrapper keys, tries to extract from object directly
    expect(items).toHaveLength(1);
    expect(items[0].description).toBe("Fallback item");
  });

  it("handles large number of items", () => {
    const bigArray = Array.from({ length: 100 }, (_, i) => ({
      description: `Item ${i}`,
      passes: i % 2 === 0,
    }));
    const items = extractPassingItems(bigArray);
    expect(items).toHaveLength(100);
    expect(items[0].passes).toBe(true);
    expect(items[1].passes).toBe(false);
  });
});

// ─── smartMerge ─────────────────────────────────────────────────────

describe("smartMerge", () => {
  const original: PrdEntry[] = [
    {
      category: "feature",
      description: "Add login page",
      steps: ["Create form"],
      passes: false,
    },
    {
      category: "feature",
      description: "Add signup page",
      steps: ["Create form"],
      passes: false,
    },
  ];

  it("updates passes for matching items", () => {
    const corrupted = [
      { description: "Add login page", passes: true },
      { description: "Add signup page", passes: false },
    ];
    const result = smartMerge(original, corrupted);
    expect(result.itemsUpdated).toBe(1);
    expect(result.merged[0].passes).toBe(true);
    expect(result.merged[1].passes).toBe(false);
  });

  it("matches by similarity", () => {
    const corrupted = [{ description: "Add login page feature", passes: true }];
    const result = smartMerge(original, corrupted);
    expect(result.itemsUpdated).toBe(1);
    expect(result.merged[0].passes).toBe(true);
  });

  it("warns on unmatched items", () => {
    const corrupted = [{ description: "Completely unrelated xyz abc", passes: true }];
    const result = smartMerge(original, corrupted);
    expect(result.itemsUpdated).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("does not modify original array", () => {
    const corrupted = [{ description: "Add login page", passes: true }];
    smartMerge(original, corrupted);
    expect(original[0].passes).toBe(false);
  });

  // --- new edge case tests ---

  it("handles empty corrupted input", () => {
    const result = smartMerge(original, []);
    expect(result.itemsUpdated).toBe(0);
    expect(result.merged).toHaveLength(2);
    expect(result.merged[0].passes).toBe(false);
    expect(result.merged[1].passes).toBe(false);
  });

  it("handles null corrupted input", () => {
    const result = smartMerge(original, null);
    expect(result.itemsUpdated).toBe(0);
    expect(result.merged).toHaveLength(2);
  });

  it("handles undefined corrupted input", () => {
    const result = smartMerge(original, undefined);
    expect(result.itemsUpdated).toBe(0);
  });

  it("handles empty original array", () => {
    const corrupted = [{ description: "Some item", passes: true }];
    const result = smartMerge([], corrupted);
    expect(result.itemsUpdated).toBe(0);
    expect(result.merged).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("does not update items that are already passing", () => {
    const alreadyPassing: PrdEntry[] = [
      { category: "feature", description: "Add login page", steps: ["Create form"], passes: true },
    ];
    const corrupted = [{ description: "Add login page", passes: true }];
    const result = smartMerge(alreadyPassing, corrupted);
    // Already passing, no update needed
    expect(result.itemsUpdated).toBe(0);
    expect(result.merged[0].passes).toBe(true);
  });

  it("skips corrupted items with passes: false", () => {
    const corrupted = [
      { description: "Add login page", passes: false },
      { description: "Add signup page", passes: false },
    ];
    const result = smartMerge(original, corrupted);
    expect(result.itemsUpdated).toBe(0);
  });

  it("can update multiple items in one merge", () => {
    const corrupted = [
      { description: "Add login page", passes: true },
      { description: "Add signup page", passes: true },
    ];
    const result = smartMerge(original, corrupted);
    expect(result.itemsUpdated).toBe(2);
    expect(result.merged[0].passes).toBe(true);
    expect(result.merged[1].passes).toBe(true);
  });

  it("matches by substring containment", () => {
    const corrupted = [{ description: "login page", passes: true }];
    const result = smartMerge(original, corrupted);
    expect(result.itemsUpdated).toBe(1);
    expect(result.merged[0].passes).toBe(true);
  });

  it("matches when corrupted description contains original description", () => {
    const corrupted = [{ description: "We need to Add login page soon", passes: true }];
    const result = smartMerge(original, corrupted);
    expect(result.itemsUpdated).toBe(1);
  });

  it("preserves category, steps, and branch from original", () => {
    const withBranch: PrdEntry[] = [
      {
        category: "bugfix",
        description: "Fix login bug",
        steps: ["Step 1", "Step 2"],
        passes: false,
        branch: "fix/login",
      },
    ];
    const corrupted = [{ description: "Fix login bug", passes: true }];
    const result = smartMerge(withBranch, corrupted);
    expect(result.merged[0].category).toBe("bugfix");
    expect(result.merged[0].steps).toEqual(["Step 1", "Step 2"]);
    expect(result.merged[0].branch).toBe("fix/login");
  });

  it("handles corrupted input from wrapped object", () => {
    const corrupted = {
      tasks: [{ description: "Add login page", passes: true }],
    };
    const result = smartMerge(original, corrupted);
    expect(result.itemsUpdated).toBe(1);
  });

  it("handles corrupted items with alternative field names", () => {
    const corrupted = [{ name: "Add login page", done: true }];
    const result = smartMerge(original, corrupted);
    expect(result.itemsUpdated).toBe(1);
    expect(result.merged[0].passes).toBe(true);
  });
});

// ─── attemptRecovery ────────────────────────────────────────────────

describe("attemptRecovery", () => {
  it("recovers from wrapped objects", () => {
    const corrupted = {
      tasks: [
        {
          category: "feature",
          description: "Add login page",
          steps: ["Create form"],
          passes: false,
        },
      ],
    };
    const result = attemptRecovery(corrupted);
    expect(result).toHaveLength(1);
    expect(result![0].description).toBe("Add login page");
  });

  it("recovers with alternative field names", () => {
    const corrupted = [
      {
        type: "feature",
        name: "Add login page",
        verification: ["Create form"],
        done: false,
      },
    ];
    const result = attemptRecovery(corrupted);
    expect(result).toHaveLength(1);
    expect(result![0].category).toBe("feature");
    expect(result![0].description).toBe("Add login page");
  });

  it("handles string passes values", () => {
    const corrupted = [
      {
        category: "bugfix",
        description: "Fix crash",
        steps: ["Test it"],
        status: "completed",
      },
    ];
    const result = attemptRecovery(corrupted);
    expect(result).not.toBeNull();
    expect(result![0].passes).toBe(true);
  });

  it("defaults missing steps", () => {
    const corrupted = [
      {
        category: "feature",
        description: "Add login page",
        passes: false,
      },
    ];
    const result = attemptRecovery(corrupted);
    expect(result).not.toBeNull();
    expect(result![0].steps).toEqual(["Verify the feature works as expected"]);
  });

  it("returns null when recovery is impossible", () => {
    expect(attemptRecovery("not an object")).toBeNull();
    expect(attemptRecovery([{ noFields: true }])).toBeNull();
  });

  it("recovers branch field", () => {
    const corrupted = [
      {
        category: "feature",
        description: "Add login",
        steps: ["test"],
        passes: false,
        branch: "feat/login",
      },
    ];
    const result = attemptRecovery(corrupted);
    expect(result![0].branch).toBe("feat/login");
  });

  // --- new edge case tests ---

  it("returns null for null input", () => {
    expect(attemptRecovery(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(attemptRecovery(undefined)).toBeNull();
  });

  it("returns null for number input", () => {
    expect(attemptRecovery(42)).toBeNull();
  });

  it("returns null for boolean input", () => {
    expect(attemptRecovery(true)).toBeNull();
  });

  it("returns null for empty array", () => {
    expect(attemptRecovery([])).toBeNull();
  });

  it("returns null for empty object (no wrapper keys)", () => {
    expect(attemptRecovery({})).toBeNull();
  });

  it("recovers from 'features' wrapper", () => {
    const corrupted = {
      features: [{ category: "feature", description: "Test", steps: ["step"], passes: false }],
    };
    const result = attemptRecovery(corrupted);
    expect(result).toHaveLength(1);
  });

  it("recovers from 'items' wrapper", () => {
    const corrupted = {
      items: [{ category: "bugfix", description: "Fix bug", steps: ["test"], passes: true }],
    };
    const result = attemptRecovery(corrupted);
    expect(result).toHaveLength(1);
    expect(result![0].passes).toBe(true);
  });

  it("recovers from 'entries' wrapper", () => {
    const corrupted = {
      entries: [
        { category: "setup", description: "Setup project", steps: ["init"], passes: false },
      ],
    };
    const result = attemptRecovery(corrupted);
    expect(result).toHaveLength(1);
  });

  it("recovers from 'requirements' wrapper", () => {
    const corrupted = {
      requirements: [{ category: "feature", description: "A requirement", passes: false }],
    };
    const result = attemptRecovery(corrupted);
    expect(result).toHaveLength(1);
    expect(result![0].steps).toEqual(["Verify the feature works as expected"]);
  });

  it("uses 'cat' as alternative for category", () => {
    const corrupted = [{ cat: "feature", description: "Test", passes: false }];
    const result = attemptRecovery(corrupted);
    expect(result).toHaveLength(1);
    expect(result![0].category).toBe("feature");
  });

  it("uses 'id' as alternative for category", () => {
    const corrupted = [{ id: "bugfix", description: "Fix it", passes: false }];
    const result = attemptRecovery(corrupted);
    expect(result).toHaveLength(1);
    expect(result![0].category).toBe("bugfix");
  });

  it("uses 'title' as alternative for description", () => {
    const corrupted = [{ category: "feature", title: "My title", passes: false }];
    const result = attemptRecovery(corrupted);
    expect(result).toHaveLength(1);
    expect(result![0].description).toBe("My title");
  });

  it("uses 'checks' as alternative for steps", () => {
    const corrupted = [
      { category: "feature", description: "Test", checks: ["check 1", "check 2"], passes: false },
    ];
    const result = attemptRecovery(corrupted);
    expect(result).toHaveLength(1);
    expect(result![0].steps).toEqual(["check 1", "check 2"]);
  });

  it("uses 'tasks' as alternative for steps", () => {
    const corrupted = [
      { category: "feature", description: "Test", tasks: ["task 1"], passes: false },
    ];
    const result = attemptRecovery(corrupted);
    expect(result).toHaveLength(1);
    expect(result![0].steps).toEqual(["task 1"]);
  });

  it("handles string passes value 'false'", () => {
    const corrupted = [
      { category: "feature", description: "Test", status: "false", passes: undefined },
    ];
    const result = attemptRecovery(corrupted);
    expect(result).not.toBeNull();
    expect(result![0].passes).toBe(false);
  });

  it("handles string passes value 'fail'", () => {
    const corrupted = [{ category: "feature", description: "Test", status: "fail" }];
    const result = attemptRecovery(corrupted);
    expect(result).not.toBeNull();
    expect(result![0].passes).toBe(false);
  });

  it("handles string passes value 'failed'", () => {
    const corrupted = [{ category: "feature", description: "Test", status: "failed" }];
    const result = attemptRecovery(corrupted);
    expect(result).not.toBeNull();
    expect(result![0].passes).toBe(false);
  });

  it("handles string passes value 'pending'", () => {
    const corrupted = [{ category: "feature", description: "Test", status: "pending" }];
    const result = attemptRecovery(corrupted);
    expect(result).not.toBeNull();
    expect(result![0].passes).toBe(false);
  });

  it("handles string passes value 'incomplete'", () => {
    const corrupted = [{ category: "feature", description: "Test", status: "incomplete" }];
    const result = attemptRecovery(corrupted);
    expect(result).not.toBeNull();
    expect(result![0].passes).toBe(false);
  });

  it("defaults passes to false when status field is unrecognized string", () => {
    const corrupted = [{ category: "feature", description: "Test", status: "in-progress" }];
    const result = attemptRecovery(corrupted);
    expect(result).not.toBeNull();
    expect(result![0].passes).toBe(false);
  });

  it("recovers multiple items", () => {
    const corrupted = [
      { category: "feature", description: "First", steps: ["s1"], passes: true },
      { category: "bugfix", description: "Second", steps: ["s2"], passes: false },
      { category: "docs", description: "Third", passes: false },
    ];
    const result = attemptRecovery(corrupted);
    expect(result).toHaveLength(3);
    expect(result![0].passes).toBe(true);
    expect(result![2].steps).toEqual(["Verify the feature works as expected"]);
  });

  it("returns null if any item is missing both category and description", () => {
    const corrupted = [
      { category: "feature", description: "Valid" },
      { steps: ["step"], passes: false }, // missing category AND description
    ];
    const result = attemptRecovery(corrupted);
    expect(result).toBeNull();
  });

  it("returns null if array contains non-object items", () => {
    const corrupted = [
      { category: "feature", description: "Valid", passes: false },
      "not an object",
    ];
    const result = attemptRecovery(corrupted);
    expect(result).toBeNull();
  });

  it("skips invalid category values and returns null", () => {
    const corrupted = [{ category: "invalid", description: "Test", passes: false }];
    const result = attemptRecovery(corrupted);
    // 'invalid' is not in VALID_CATEGORIES, so category won't be set -> null
    expect(result).toBeNull();
  });

  it("recovers git_branch alternative field", () => {
    const corrupted = [
      { category: "feature", description: "Test", git_branch: "feat/test", passes: false },
    ];
    const result = attemptRecovery(corrupted);
    expect(result).toHaveLength(1);
    expect(result![0].branch).toBe("feat/test");
  });

  it("recovers gitBranch alternative field", () => {
    const corrupted = [
      { category: "feature", description: "Test", gitBranch: "feat/camel", passes: false },
    ];
    const result = attemptRecovery(corrupted);
    expect(result).toHaveLength(1);
    expect(result![0].branch).toBe("feat/camel");
  });

  it("filters non-string steps from alternative step fields", () => {
    const corrupted = [
      {
        category: "feature",
        description: "Test",
        verification: ["valid", 123, null, "also valid"],
        passes: false,
      },
    ];
    const result = attemptRecovery(corrupted);
    expect(result).toHaveLength(1);
    expect(result![0].steps).toEqual(["valid", "also valid"]);
  });
});

// ─── robustYamlParse ────────────────────────────────────────────────

describe("robustYamlParse", () => {
  it("parses valid YAML", () => {
    const result = robustYamlParse("- name: test\n  value: 1\n");
    expect(result).toEqual([{ name: "test", value: 1 }]);
  });

  it("parses simple scalars", () => {
    expect(robustYamlParse("hello")).toBe("hello");
  });

  it("handles multiline strings that would normally fail", () => {
    const yaml = `- Implement each stage as its own class in
    separate files
- Another item`;
    const result = robustYamlParse(yaml);
    expect(Array.isArray(result)).toBe(true);
  });

  // --- new edge case tests ---

  it("parses empty string as null", () => {
    expect(robustYamlParse("")).toBeNull();
  });

  it("parses YAML boolean values", () => {
    expect(robustYamlParse("true")).toBe(true);
    expect(robustYamlParse("false")).toBe(false);
  });

  it("parses YAML numbers", () => {
    expect(robustYamlParse("42")).toBe(42);
    expect(robustYamlParse("3.14")).toBeCloseTo(3.14);
  });

  it("parses nested YAML objects", () => {
    const yaml = `
name: test
nested:
  key: value
  list:
    - a
    - b`;
    const result = robustYamlParse(yaml) as Record<string, unknown>;
    expect(result.name).toBe("test");
    expect((result.nested as any).key).toBe("value");
    expect((result.nested as any).list).toEqual(["a", "b"]);
  });

  it("parses YAML with quoted strings", () => {
    const yaml = `- "hello world"
- 'single quoted'
- plain text`;
    const result = robustYamlParse(yaml) as string[];
    expect(result).toEqual(["hello world", "single quoted", "plain text"]);
  });

  it("handles YAML with embedded colons in values", () => {
    const yaml = `- category: feature
  description: "Add server: port config"
  passes: false`;
    const result = robustYamlParse(yaml);
    expect(Array.isArray(result)).toBe(true);
  });

  it("parses multi-item YAML PRD", () => {
    const yaml = `- category: feature
  description: Add login
  steps:
    - Create form
    - Add validation
  passes: false
- category: bugfix
  description: Fix crash
  steps:
    - Debug issue
  passes: true`;
    const result = robustYamlParse(yaml) as any[];
    expect(result).toHaveLength(2);
    expect(result[0].category).toBe("feature");
    expect(result[1].passes).toBe(true);
  });

  it("handles YAML null values", () => {
    const yaml = "value: null";
    const result = robustYamlParse(yaml) as Record<string, unknown>;
    expect(result.value).toBeNull();
  });

  it("handles YAML with block scalar (literal)", () => {
    const yaml = `text: |
  line one
  line two`;
    const result = robustYamlParse(yaml) as Record<string, unknown>;
    expect(result.text).toContain("line one");
    expect(result.text).toContain("line two");
  });

  it("handles YAML with folded scalar", () => {
    const yaml = `text: >
  line one
  line two`;
    const result = robustYamlParse(yaml) as Record<string, unknown>;
    expect(typeof result.text).toBe("string");
  });
});

// ─── expandFileReferences ───────────────────────────────────────────

describe("expandFileReferences", () => {
  it("returns empty string for non-string input", () => {
    expect(expandFileReferences(null as unknown as string, "/base")).toBe("");
    expect(expandFileReferences(undefined as unknown as string, "/base")).toBe("");
  });

  it("returns text unchanged when no references", () => {
    expect(expandFileReferences("Hello world", "/base")).toBe("Hello world");
  });

  it("replaces missing file references with error message", () => {
    const result = expandFileReferences("Load @{/nonexistent/file.txt} here", "/base");
    expect(result).toContain("[File not found:");
  });

  // --- new edge case tests ---

  it("returns empty string for empty string input", () => {
    expect(expandFileReferences("", "/base")).toBe("");
  });

  it("handles multiple file references in one string", () => {
    const result = expandFileReferences(
      "Load @{/nonexistent/a.txt} and @{/nonexistent/b.txt}",
      "/base",
    );
    expect(result).toContain("[File not found:");
    // Both should be replaced
    expect(result.match(/\[File not found:/g)).toHaveLength(2);
  });

  it("handles text with @{ but no closing brace", () => {
    const result = expandFileReferences("Some text with @{ unclosed", "/base");
    // No match for the pattern, returns text unchanged
    expect(result).toBe("Some text with @{ unclosed");
  });

  it("handles empty file reference @{} (no match since pattern requires content)", () => {
    const result = expandFileReferences("@{}", "/base");
    // The regex requires at least one char inside braces, so @{} is left unchanged
    expect(result).toBe("@{}");
  });

  it("preserves surrounding text around file references", () => {
    const result = expandFileReferences("Before @{/nonexistent.txt} After", "/base");
    expect(result).toMatch(/^Before .* After$/);
  });

  it("handles numeric input (non-string) via nullish coalescing", () => {
    // Non-string input should still return a string per the function's contract
    const result = expandFileReferences(42 as unknown as string, "/base");
    expect(typeof result).toBe("string");
    expect(result).toBe(String(42));
  });

  it("handles boolean input (non-string) via nullish coalescing", () => {
    // Non-string input should still return a string per the function's contract
    const result = expandFileReferences(true as unknown as string, "/base");
    expect(typeof result).toBe("string");
    expect(result).toBe(String(true));
  });

  it("handles absolute file paths", () => {
    const result = expandFileReferences("@{/absolute/path/file.txt}", "/base");
    expect(result).toContain("[File not found: /absolute/path/file.txt]");
  });

  it("resolves relative file paths against base dir", () => {
    const result = expandFileReferences("@{relative/path.txt}", "/base");
    expect(result).toContain("[File not found: /base/relative/path.txt]");
  });
});

// ─── expandPrdFileReferences ────────────────────────────────────────

describe("expandPrdFileReferences", () => {
  it("expands file references in description and steps", () => {
    const entries: PrdEntry[] = [
      {
        category: "feature",
        description: "Implement @{/nonexistent/spec.txt}",
        steps: ["Check @{/nonexistent/check.txt}", "No reference here"],
        passes: false,
      },
    ];
    const result = expandPrdFileReferences(entries, "/base");
    expect(result[0].description).toContain("[File not found:");
    expect(result[0].steps[0]).toContain("[File not found:");
    expect(result[0].steps[1]).toBe("No reference here");
  });

  it("does not modify the original entries", () => {
    const entries: PrdEntry[] = [
      {
        category: "feature",
        description: "Original @{/nonexistent.txt}",
        steps: ["Original step"],
        passes: false,
      },
    ];
    const result = expandPrdFileReferences(entries, "/base");
    expect(entries[0].description).toBe("Original @{/nonexistent.txt}");
    expect(result[0].description).toContain("[File not found:");
  });

  it("preserves category, passes, and branch", () => {
    const entries: PrdEntry[] = [
      {
        category: "bugfix",
        description: "Fix it",
        steps: ["step"],
        passes: true,
        branch: "fix/branch",
      },
    ];
    const result = expandPrdFileReferences(entries, "/base");
    expect(result[0].category).toBe("bugfix");
    expect(result[0].passes).toBe(true);
    expect(result[0].branch).toBe("fix/branch");
  });

  it("handles empty entries array", () => {
    const result = expandPrdFileReferences([], "/base");
    expect(result).toEqual([]);
  });

  it("handles entries with no file references", () => {
    const entries: PrdEntry[] = [
      {
        category: "feature",
        description: "Plain text",
        steps: ["Plain step"],
        passes: false,
      },
    ];
    const result = expandPrdFileReferences(entries, "/base");
    expect(result[0].description).toBe("Plain text");
    expect(result[0].steps[0]).toBe("Plain step");
  });
});

// ─── createTemplatePrd ──────────────────────────────────────────────

describe("createTemplatePrd", () => {
  it("creates default template without backup", () => {
    const result = createTemplatePrd();
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("setup");
    expect(result[0].description).toBe("Add PRD entries");
    expect(result[0].passes).toBe(false);
  });

  it("creates recovery template with backup path", () => {
    const result = createTemplatePrd("/backup/prd.json");
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe("Fix the PRD entries");
    expect(result[0].steps[0]).toContain("@{/backup/prd.json}");
  });

  // --- new edge case tests ---

  it("default template has two steps", () => {
    const result = createTemplatePrd();
    expect(result[0].steps).toHaveLength(2);
    expect(result[0].steps[0]).toContain("ralph add");
    expect(result[0].steps[1]).toContain("format");
  });

  it("recovery template has two steps", () => {
    const result = createTemplatePrd("/some/backup.yaml");
    expect(result[0].steps).toHaveLength(2);
    expect(result[0].steps[0]).toContain("corrupted backup");
    expect(result[0].steps[1]).toContain("valid entries");
  });

  it("uses absolute path for backup reference when path is already absolute", () => {
    const result = createTemplatePrd("/absolute/path/backup.json");
    expect(result[0].steps[0]).toContain("@{/absolute/path/backup.json}");
  });

  it("all template items have passes set to false", () => {
    const defaultResult = createTemplatePrd();
    const recoveryResult = createTemplatePrd("/backup.json");
    expect(defaultResult[0].passes).toBe(false);
    expect(recoveryResult[0].passes).toBe(false);
  });

  it("all template items have category 'setup'", () => {
    const defaultResult = createTemplatePrd();
    const recoveryResult = createTemplatePrd("/backup.json");
    expect(defaultResult[0].category).toBe("setup");
    expect(recoveryResult[0].category).toBe("setup");
  });
});
