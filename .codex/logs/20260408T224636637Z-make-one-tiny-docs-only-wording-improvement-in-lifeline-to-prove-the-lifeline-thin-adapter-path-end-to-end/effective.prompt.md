Objective
Make one tiny docs-only wording improvement in Lifeline to prove the Lifeline thin adapter path end to end.

Requirements
- Change only README.md or docs/**
- Keep the change tiny and safe
- Emit valid .codex/commit-meta.json
- Do not touch sibling repos
- Do not push

Verification
- Run the default Lifeline verify commands
- Auto-commit on successful mutation
- Archive the prompt and write run logs

Output
Return a short summary of what changed and the final commit message.

Commit metadata contract:
- If you make repository changes that should be committed, write UTF-8 JSON to .codex/commit-meta.json.
- Use exactly this shape: {"type":"<type>","scope":"<scope>","summary":"<summary>"}
- Allowed commit types: feat, fix, docs, refactor, test, chore.
- Scope must be a short lowercase slug using letters, digits, and hyphens.
- Summary must be specific, contain at least two words, and must not be generic like update, done, fixes, or misc changes.
- If you make no repository changes, do not create the commit metadata artifact.
- The runner will consume and remove the artifact before staging.
- Do not push. Push remains manual-only.