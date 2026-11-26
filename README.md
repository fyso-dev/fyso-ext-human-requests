# Human requests extension

Copier extension for Dagu human tasks, published independently from the Fyso Agentic Framework. Versions are the Git tags of this repository, starting at **v0.1.0**. From a generated project:

```sh
mise run ext:add gh:fyso-dev/fyso-ext-human-requests -- --defaults --vcs-ref v0.2.0
mise run doctor
```

Enable the `human-requests` skill per bot in the panel. No extra service, port, or secret is required.

This is a beta. In isolated tests, a real bot created a request through Dagu 2.24.0, a second browser session answered through the authenticated gateway, and the answer returned to the same OpenMausBot conversation. A stopped-server retry was tested with a single fictional effect; the normal generated-stack lifecycle is not yet verified for that experiment. A saved answer is checked against the run's choices before delivery, including for API callers. Dagu stores the answer before this validation: an invalid submission cannot be corrected in place and needs a new request. See the skill for the creation contract.

## People directory and Fyso Biz

The **People** page keeps a descriptive directory as Dagu wiki pages `fyso-people/<uuid>` with content `{"version":1,"name":"..."}`. When the project is connected to Fyso Biz, the [fyso-ext-biz](https://github.com/fyso-dev/fyso-ext-biz) extension fills it with the people who have access to the Biz project; those records also carry `"source":"biz"` and `"biz_id"`. They are shown read-only with a "Managed by Fyso Biz" label, and the page refuses to edit or remove them, even if a record became managed after the list was loaded. Manual people can still be added, edited and removed. This extension never writes `source` or `biz_id`; readers ignore fields they do not use.

## Bot setup (scoped Dagu access)

Enable the `human-requests` skill for each bot that needs it. For a bot without full Dagu access, use the panel's **Add MCP** flow to create an enabled stdio server with an exclusive name, command `node`, and these arguments:

```json
["${FYSO_ROOT}/framework/scripts/fyso-mcp.cjs", "--scope", "human-requests", "--system", "ext-human-requests-request"]
```

Assign that MCP server and its Dagu read and execute tools to the bot. The named scope includes the explicitly granted request workflow and any project workflows labeled for that scope. Choose a name that does not collide with an existing native MCP server: restore updates servers with matching names. Managed definitions are saved in `project/omb-mcp.json` and restored through the native OpenMausBot API when the project starts; see the framework's connectors documentation for the existing snapshot and restore behavior. The server definition contains no credentials; the platform supplies Dagu connection settings at runtime.

This workflow scope is a guardrail, not a security boundary: a bot with `native:*` can run commands outside the scoped MCP. Individual identity and authorization are still required for sensitive decisions.

On OpenMausBot 0.1.141 with the Codex CLI 0.169.0, a Codex bot does not see this server or any other project MCP server; it sees the host user's personal Codex servers instead. That is a problem of the engine integration, not of this setup, and the same bot on a Claude model completes the whole flow. Until it is resolved, use a Claude model for bots that create requests. Details are in the framework's delivery evidence for human requests.

The recipient label is a routing hint, not authorization. The responder is self-declared. HTTP return is disabled until an operator configures a single exact HTTPS destination and credential; the receiver must implement the [idempotency contract](extensions/human-requests/HTTP.md). OpenMausBot accepts a deterministic send ID for duplicate messages, but acknowledgement does not prove the bot completed its work or that external effects are exactly once. Do not use this for sensitive approvals without individual identity and access controls.

## Update and migrate

Installations from this repository record the tag in `_commit` and update through Copier's normal three-way update:

```sh
mise run ext:update human-requests -- --defaults
mise run doctor
```

An installation from the framework's bundled directory (`./framework/extensions/human-requests`) has no `_commit` and cannot be updated that way. Commit pending project changes, then migrate it once to this source; existing answers are reused:

```sh
mise run ext:add gh:fyso-dev/fyso-ext-human-requests -- --defaults --overwrite --vcs-ref v0.2.0
```

## Development

```sh
node --test tests/*.test.mjs
```

CI runs these tests, a syntax check of the workflow scripts and a check that both locales have the same keys. Changes are listed in [CHANGELOG.md](CHANGELOG.md); a release is a tag on `main`.

## License

Copyright (C) 2026 Fyso.

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, version 3 (`AGPL-3.0-only`). It is distributed WITHOUT ANY WARRANTY; see [LICENSE](LICENSE) for the full text.
