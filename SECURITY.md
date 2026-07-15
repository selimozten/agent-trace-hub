# Security Policy

Agent Trace Hub processes transcripts that can contain source code, filesystem
paths, credentials, user prompts, tool output, and other sensitive data.

## Reporting A Vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private
security advisory flow:

<https://github.com/selimozten/agent-trace-hub/security/advisories/new>

Include the affected command, version, impact, reproduction steps, and any
suggested mitigation. You should receive an acknowledgement within seven days.

## Data Safety

- Treat raw and canonical traces as private unless they have passed your audit
  and review policy.
- Run `ath audit --profile public` before publishing a dataset.
- Review deterministic findings and preserved image blocks manually.
- Do not report vulnerabilities using real credentials or unredacted private
  traces. Use a minimal synthetic reproduction.

Discovery, normalization, validation, auditing, rendering, and release
packaging run locally. The optional inherited review and upload workflows can
invoke external tools or services when you explicitly run them.

## Supported Versions

Security fixes are applied to the latest release. Older pre-1.0 releases are
not maintained after a newer release is available.
