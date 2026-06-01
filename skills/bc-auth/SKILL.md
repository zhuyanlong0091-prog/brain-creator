---
name: bc-auth
description: Use when configuring encrypted authentication for a Brain Creator business system through MCP tools.
---

# Brain Creator Auth

Use the Brain Creator MCP auth tools to store credentials without exposing secrets in later conversation.

## Workflow

1. Call `bc_create_auth` with the selected system id as `projectId`.
2. Call `bc_verify_auth` after creating the profile.
3. Do not repeat raw token, cookie, or password values after the tool call.

## Notes

- Supported `loginMethod` values are `password`, `cookie`, `token`, and `script`.
- Returned auth profiles redact all secrets.
- Generated seed files may contain local secrets and must stay out of git.
