export interface TechnologyStack {
  name: string;
  description: string;
}

export interface LanguageConfig {
  name: string;
  checkCommand: string;
  testCommand: string;
  description: string;
  technologies?: TechnologyStack[];
}

export const LANGUAGES: Record<string, LanguageConfig> = {
  bun: {
    name: "Bun (TypeScript)",
    checkCommand: "bun check",
    testCommand: "bun test",
    description: "Bun runtime with TypeScript",
    technologies: [
      { name: "Elysia", description: "Fast web framework for Bun" },
      { name: "Hono", description: "Lightweight web framework" },
      { name: "Drizzle ORM", description: "TypeScript ORM" },
      { name: "Prisma", description: "Type-safe database ORM" },
      { name: "SQLite", description: "Embedded SQL database" },
      { name: "PostgreSQL", description: "Advanced SQL database" },
    ],
  },
  node: {
    name: "Node.js (TypeScript)",
    checkCommand: "npm run typecheck",
    testCommand: "npm test",
    description: "Node.js with TypeScript",
    technologies: [
      { name: "Express", description: "Minimal web framework" },
      { name: "Fastify", description: "High-performance web framework" },
      { name: "NestJS", description: "Progressive Node.js framework" },
      { name: "Next.js", description: "React framework for production" },
      { name: "Prisma", description: "Type-safe database ORM" },
      { name: "TypeORM", description: "TypeScript ORM" },
      { name: "Jest", description: "JavaScript testing framework" },
      { name: "Vitest", description: "Fast unit testing framework" },
      { name: "PostgreSQL", description: "Advanced SQL database" },
      { name: "MongoDB", description: "NoSQL document database" },
      { name: "Redis", description: "In-memory data store" },
    ],
  },
  python: {
    name: "Python",
    checkCommand: "mypy .",
    testCommand: "pytest",
    description: "Python with mypy type checking",
    technologies: [
      { name: "FastAPI", description: "Modern async web framework" },
      { name: "Django", description: "Full-featured web framework" },
      { name: "Flask", description: "Lightweight web framework" },
      { name: "SQLAlchemy", description: "SQL toolkit and ORM" },
      { name: "Pydantic", description: "Data validation library" },
      { name: "Celery", description: "Distributed task queue" },
      { name: "PostgreSQL", description: "Advanced SQL database" },
      { name: "Redis", description: "In-memory data store" },
      { name: "pytest", description: "Testing framework" },
    ],
  },
  go: {
    name: "Go",
    checkCommand: "go build ./...",
    testCommand: "go test ./...",
    description: "Go language",
    technologies: [
      { name: "Gin", description: "High-performance web framework" },
      { name: "Echo", description: "Minimalist web framework" },
      { name: "Fiber", description: "Express-inspired web framework" },
      { name: "GORM", description: "ORM library for Go" },
      { name: "sqlx", description: "SQL extensions for Go" },
      { name: "PostgreSQL", description: "Advanced SQL database" },
      { name: "Redis", description: "In-memory data store" },
    ],
  },
  rust: {
    name: "Rust",
    checkCommand: "cargo check",
    testCommand: "cargo test",
    description: "Rust with Cargo",
    technologies: [
      { name: "Actix-web", description: "Powerful web framework" },
      { name: "Axum", description: "Ergonomic web framework" },
      { name: "Rocket", description: "Web framework with focus on ease" },
      { name: "Diesel", description: "Safe, extensible ORM" },
      { name: "SQLx", description: "Async SQL toolkit" },
      { name: "Tokio", description: "Async runtime" },
      { name: "Serde", description: "Serialization framework" },
      { name: "PostgreSQL", description: "Advanced SQL database" },
    ],
  },
  java: {
    name: "Java",
    checkCommand: "mvn compile",
    testCommand: "mvn test",
    description: "Java with Maven",
    technologies: [
      { name: "Spring Boot", description: "Production-ready framework" },
      { name: "Quarkus", description: "Kubernetes-native Java" },
      { name: "Micronaut", description: "Modern JVM framework" },
      { name: "Hibernate", description: "ORM framework" },
      { name: "JPA", description: "Java Persistence API" },
      { name: "JUnit", description: "Testing framework" },
      { name: "PostgreSQL", description: "Advanced SQL database" },
      { name: "MySQL", description: "Popular SQL database" },
    ],
  },
  kotlin: {
    name: "Kotlin",
    checkCommand: "gradle build",
    testCommand: "gradle test",
    description: "Kotlin with Gradle",
    technologies: [
      { name: "Ktor", description: "Asynchronous web framework" },
      { name: "Spring Boot", description: "Production-ready framework" },
      { name: "Exposed", description: "Kotlin SQL framework" },
      { name: "Koin", description: "Dependency injection framework" },
      { name: "Kotest", description: "Kotlin testing framework" },
      { name: "kotlinx.coroutines", description: "Coroutines for async programming" },
      { name: "kotlinx.serialization", description: "Multiplatform serialization" },
      { name: "PostgreSQL", description: "Advanced SQL database" },
      { name: "MongoDB", description: "NoSQL document database" },
    ],
  },
  none: {
    name: "None (custom)",
    checkCommand: "echo 'no check configured'",
    testCommand: "echo 'no tests configured'",
    description: "Custom configuration",
  },
};

// Generate the prompt template with $variables (stored in prompt.md)
export function generatePromptTemplate(): string {
  return `You are an AI developer working on this project. Your task is to implement features from the PRD.

TECHNOLOGY STACK:
- Language/Runtime: $language
- Technologies: $technologies

INSTRUCTIONS:
1. Read the @.ralph/prd.json file to find the highest priority feature that has "passes": false
2. Implement that feature completely
3. Verify your changes work by running:
   - Type/build check: $checkCommand
   - Tests: $testCommand
4. Update the PRD entry to set "passes": true once verified
5. Append a brief note about what you did to @.ralph/progress.txt
6. Create a git commit with a descriptive message for this feature
7. Only work on ONE feature per execution

IMPORTANT:
- Focus on a single feature at a time
- Ensure all checks pass before marking complete
- Write clear commit messages
- If the PRD is fully complete (all items pass), output: <promise>COMPLETE</promise>

Now, read the PRD and begin working on the highest priority incomplete feature.`;
}

// Resolve template variables using config values
export function resolvePromptVariables(template: string, config: {
  language: string;
  checkCommand: string;
  testCommand: string;
  technologies?: string[];
}): string {
  const languageConfig = LANGUAGES[config.language];
  const languageName = languageConfig?.name || config.language;
  const technologies = config.technologies?.length ? config.technologies.join(", ") : "(none specified)";

  return template
    .replace(/\$language/g, languageName)
    .replace(/\$technologies/g, technologies)
    .replace(/\$checkCommand/g, config.checkCommand)
    .replace(/\$testCommand/g, config.testCommand);
}

// Legacy function for backwards compatibility - generates fully resolved prompt
export function generatePrompt(config: LanguageConfig, technologies?: string[]): string {
  const template = generatePromptTemplate();
  return resolvePromptVariables(template, {
    language: Object.keys(LANGUAGES).find(k => LANGUAGES[k].name === config.name) || "none",
    checkCommand: config.checkCommand,
    testCommand: config.testCommand,
    technologies,
  });
}

export const DEFAULT_PRD = `[
  {
    "category": "setup",
    "description": "Example: Project builds successfully",
    "steps": [
      "Run the build command",
      "Verify no errors occur"
    ],
    "passes": false
  }
]`;

export const DEFAULT_PROGRESS = `# Progress Log\n`;
