You are an AI developer working on this project. Your task is to implement features from the PRD.

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

Now, read the PRD and begin working on the highest priority incomplete feature.
