---
name: bc-auth
description: Use when configuring encrypted authentication for a Brain Creator business system through MCP tools.
---

# Brain Creator Auth

Use the Brain Creator MCP auth tools to store credentials without exposing secrets in later conversation.

## Workflow

1. Call `bc_create_auth` with the selected system id as `projectId`.
2. Call `bc_verify_auth` after creating the profile.
3. Call `bc_list_auth` when you need to inspect configured profiles for the selected system.
4. Call `bc_generate_seed` only when a local Playwright seed fixture is needed for Planner or Generator execution.
5. Do not repeat raw token, cookie, or password values after the tool call.
6. Call `bc_create_auth_checkpoint` when the user must manually complete password, recovery, CAPTCHA, or 2FA.
7. Call `bc_complete_auth_checkpoint` after the user confirms the protected step is complete, or `bc_cancel_auth_checkpoint` when they stop.
8. Call `bc_archive_auth` when an auth profile should be retained for history but no longer used.

## Notes

- Supported `loginMethod` values are `password`, `cookie`, `token`, and `script`.
- Returned auth profiles redact all secrets.
- `bc_generate_seed` returns only metadata; generated seed files may contain local secrets and must stay out of git.
- Auth checkpoints contain reasons and resume instructions only. Never put credentials or verification codes in them.
