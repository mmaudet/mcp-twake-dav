# Contributing to mcp-twake-dav

Thank you for your interest in contributing to mcp-twake-dav! This document provides guidelines and instructions for contributing.

## Getting Started

1. Fork the repository on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/<your-username>/mcp-twake-dav.git
   cd mcp-twake-dav
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Build the project:
   ```bash
   npm run build
   ```
5. Run tests to verify your setup:
   ```bash
   npm test
   ```

## Development Workflow

### Branch naming

Use descriptive branch names:
- `feat/calendar-filtering` for new features
- `fix/auth-timeout` for bug fixes
- `docs/readme-update` for documentation changes
- `refactor/service-layer` for refactoring
- `test/recurrence-expansion` for test additions

### Making changes

1. Create a feature branch from `master`:
   ```bash
   git checkout -b feat/your-feature
   ```
2. Make your changes following the code style guidelines below
3. Run the build to check for TypeScript errors:
   ```bash
   npm run build
   ```
4. Run tests:
   ```bash
   npm test
   ```
5. Commit your changes with a clear message (see commit conventions below)
6. Push to your fork and open a Pull Request

### Watch mode

For rapid iteration during development:
```bash
npm run dev
```
This runs the TypeScript compiler in watch mode, recompiling on file changes.

## Code Style Guidelines

### TypeScript

- **Strict mode** is enabled -- all code must pass strict type checking
- Use **ESM imports** with `.js` extensions (required by the MCP SDK):
  ```typescript
  import { CalendarService } from './caldav/calendar-service.js';
  ```
- Use `type` imports when importing only types:
  ```typescript
  import type { Logger } from 'pino';
  ```
- Prefer `interface` over `type` for object shapes
- Use explicit return types on exported functions

### Project structure

```
src/
  caldav/          # CalDAV/CardDAV client, services, caching, retry
  config/          # Environment validation (Zod), logger setup
  tools/           # MCP tool implementations
    calendar/      # Calendar query tools + utilities
    contacts/      # Contact query tools + utilities
  transformers/    # iCalendar/vCard parsing and transformation
  types/           # Shared TypeScript types and DTOs
tests/
  integration/     # MCP protocol integration tests
```

### Conventions

- All logs go to **stderr** (stdout is reserved for MCP JSON-RPC protocol)
- Services return raw DAV objects; transformation to DTOs happens in the tools layer
- CTag-based caching is handled at the service level
- Tools use Zod schemas for parameter validation

## Commit Conventions

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <short description>

[optional body]
```

Types:
- `feat:` -- new feature
- `fix:` -- bug fix
- `docs:` -- documentation changes
- `test:` -- adding or updating tests
- `refactor:` -- code refactoring (no functional change)
- `chore:` -- build, CI, dependency updates

Examples:
```
feat: add calendar filtering by name
fix: handle empty displayName in address book lookup
docs: update README with npx installation
test: add integration test for search_events calendar param
```

## Pull Request Guidelines

- Keep PRs focused on a single concern
- Include a clear description of what changes and why
- Ensure all tests pass (`npm test`)
- Ensure the build succeeds (`npm run build`)
- Update documentation if your change affects the public API or configuration
- Link related issues in the PR description

## Reporting Bugs

Use the [Bug Report](https://github.com/mmaudet/mcp-twake-dav/issues/new?template=bug_report.md) issue template. Include:
- Steps to reproduce
- Expected vs actual behavior
- Environment details (Node.js version, OS, CalDAV server)

## Requesting Features

Use the [Feature Request](https://github.com/mmaudet/mcp-twake-dav/issues/new?template=feature_request.md) issue template. Describe:
- The use case or problem
- Your proposed solution
- Any alternatives you considered

## License

By contributing to mcp-twake-dav, you agree that your contributions will be licensed under the [AGPL-3.0 license](LICENSE). All modifications must be shared under the same terms.
