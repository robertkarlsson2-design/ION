# Security Policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, email **security@ion-lang.dev** (or open a [GitHub private security advisory](https://github.com/robertkarlsson2-design/ION/security/advisories/new)) with:

- A description of the vulnerability
- Steps to reproduce
- Potential impact

You can expect a response within 72 hours. We will coordinate a fix and disclosure timeline with you.

## Scope

The Ion compiler is a local CLI tool with no network access and no runtime component. The primary security concerns are:

- **Arbitrary code execution via crafted `.ion` files** — the compiler should not execute input or shell out based on source content
- **Path traversal in output paths** — `ion build` output must be confined to the configured `outDir`
- **Dependency vulnerabilities** — reported via `pnpm audit`
