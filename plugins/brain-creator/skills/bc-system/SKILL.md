---
name: bc-system
description: Use when connecting or reviewing a business system in Brain Creator v2 through MCP tools.
---

# Brain Creator System

Use the Brain Creator MCP tools to create and inspect reusable business system contexts.

## Workflow

1. Call `bc_create_system` when a user wants to connect a Web system.
2. Call `bc_list_systems` before assuming a system already exists.
3. Call `bc_system_overview` to summarize onboarding completeness and asset counts.

## Required Fields

- `name`: business system name.
- `environment`: target environment such as staging or test.
- `baseUrl`: root URL for the system.
- `defaultLocale`: default language, usually `zh-CN`.
- `urlAllowlist`: URLs the agents may explore.

Never mix assets across systems. Every later Brain Creator action must use the selected system id.
