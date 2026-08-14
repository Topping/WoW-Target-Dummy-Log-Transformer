# Repository agent instructions

## Git publishing

- Use the standard `git` CLI for repository status, staging, commits, and pushes.
- Do not require or invoke the GitHub CLI (`gh`) for a commit-and-push request.
- A commit-and-push request does not imply creating a pull request. Use GitHub-specific tooling only when the user explicitly requests a pull request or another GitHub-only operation.
