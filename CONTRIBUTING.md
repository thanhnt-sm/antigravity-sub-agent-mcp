# Contributing to Antigravity Sub-Agent MCP

Thank you for your interest in contributing! This guide will help you get started.

## Getting Started

1. **Fork** the repository
2. **Clone** your fork: `git clone https://github.com/<your-username>/antigravity-sub-agent-mcp.git`
3. **Install** dependencies: `npm install`
4. **Create a branch**: `git checkout -b feat/your-feature`

## Development

### Prerequisites

- Node.js 18+
- Antigravity IDE (for testing)

### Running Locally

```bash
npm start
```

### Code Style

- ESM modules (`import`/`export`)
- Descriptive variable names
- Comments for non-obvious logic
- Consistent logging via `process.stderr.write()`

## Submitting Changes

1. Ensure your code runs without errors: `node --check index.js`
2. Write clear commit messages following [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat: add new model alias`
   - `fix: handle timeout edge case`
   - `docs: update setup instructions`
3. Push to your fork and open a **Pull Request**
4. Describe what your PR does and why

## Reporting Issues

- Use [GitHub Issues](https://github.com/khanhnguyen/antigravity-sub-agent-mcp/issues)
- Include: Node.js version, OS, steps to reproduce, expected vs actual behavior
- Include relevant stderr logs if applicable

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold this standard.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
