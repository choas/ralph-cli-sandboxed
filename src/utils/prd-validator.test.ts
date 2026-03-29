import { describe, it, expect } from "vitest";
import {
  validatePrd,
  extractPassingItems,
  smartMerge,
  attemptRecovery,
  robustYamlParse,
  expandFileReferences,
  createTemplatePrd,
  type PrdEntry,
} from "./prd-validator.js";

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
});

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
});

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
});

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
});

describe("robustYamlParse", () => {
  it("parses valid YAML", () => {
    const result = robustYamlParse("- name: test\n  value: 1\n");
    expect(result).toEqual([{ name: "test", value: 1 }]);
  });

  it("parses simple scalars", () => {
    expect(robustYamlParse("hello")).toBe("hello");
  });

  it("handles multiline strings that would normally fail", () => {
    // This tests the fix for continuation lines
    const yaml = `- Implement each stage as its own class in
    separate files
- Another item`;
    const result = robustYamlParse(yaml);
    expect(Array.isArray(result)).toBe(true);
  });
});

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
});

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
});
