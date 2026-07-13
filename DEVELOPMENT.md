# Development workflow

## Requirements

- Node.js `>=22.12.0 <25`
- npm `>=10`
- MySQL for production-like development; tests use an in-memory SQLite database

## Reproducible installation

Install only from the committed lockfiles:

```bash
npm ci
npm --prefix frontend ci
```

Do not use `npm install` in CI or deployment. When intentionally changing a
dependency, update and review the corresponding `package-lock.json`.

## Local development

Backend:

```bash
copy .env.example .env
npm run dev
```

Frontend, in a second terminal:

```bash
npm --prefix frontend run dev
```

## Required checks

Run all local quality gates with:

```bash
npm run check
```

The individual commands are:

```bash
npm run lint
npm run format:check
npm test
npm run build:frontend
```

Use `npm run format` to apply the shared formatting rules. Runtime code in
`legacy_src/` is archived and deliberately excluded from automated formatting
and linting.

## Continuous integration

`.github/workflows/ci.yml` runs on pushes and pull requests with Node 22.12.0.
It performs backend linting, formatting verification, tests with coverage,
frontend production build, and production-dependency security audits.
Coverage is protected by baseline global thresholds in `jest.config.js`; these
thresholds should be raised as untested controllers and integrations gain tests.

## Source-control prerequisite

The current workspace was delivered without readable Git metadata. Before
collaborative development, reconnect it to the original remote repository and
recover its history. Do not initialize a replacement repository if the original
history exists elsewhere: doing so would lose authorship and change traceability.
