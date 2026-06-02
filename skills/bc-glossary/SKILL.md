---
name: bc-glossary
description: Use when adding, listing, or confirming Brain Creator glossary terms through MCP.
---

# Brain Creator Glossary

Use Brain Creator glossary tools to keep business language reusable across planning and generation.

## Workflow

1. Call `bc_add_term` for known domain terms before planning.
2. Include aliases and `pageScope` when a term only applies to part of the system.
3. After `bc_generate_plan`, review `testCase.newTerms` with the user.
4. Call `bc_batch_confirm_terms` with confirmed candidate ids and ignored candidate ids.
5. Call `bc_update_term` when the user corrects wording, aliases, or page scope.
6. Call `bc_delete_term` when the user says a term should not be reusable system knowledge.
7. Call `bc_list_terms` to show the updated glossary.

Do not silently add every candidate term. The user should confirm terms that become reusable system knowledge.
Do not delete terms without explicit user confirmation.
