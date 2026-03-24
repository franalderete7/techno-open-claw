# Legacy References

Drop old TechnoStore reference material here so the resident agent can recreate useful business behavior in the new app.

## What to copy here

Best candidates:

- old n8n workflow JSON exports
- old prompt text
- store policy docs
- sample conversations
- response rules
- product matching rules
- storefront order handoff rules
- WhatsApp / ManyChat behavior notes
- any `v15`, `v16`, or `v17` architecture notes you still have

## Why this folder exists

The agent running on the VPS should not depend on chat history to understand the old business logic.

If the old behavior matters, put the source material here and make it part of the repo.

## Recommended naming

Examples:

- `v15_orchestrator.json`
- `v16_whatsapp_api.json`
- `v17_architecture_notes.md`
- `prompt_sales_agent_v15.md`
- `manychat_rules.md`
- `storefront_handoff_examples.md`
- `sample_customer_flows.md`

## How the agent should use this folder

1. Read `AGENTS.md`
2. Read `docs/OPERATOR_PLAYBOOK.md`
3. Read `docs/MIGRATION_HANDOFF.md`
4. Read everything relevant in `docs/legacy/`
5. Recreate business behavior in the app and scripts, not in n8n

## Important rule

Legacy materials are reference inputs only.

Do not rebuild the old architecture literally unless there is a very good reason. Use the old logic to improve the new app-backed operator system.
