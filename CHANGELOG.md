# Changelog

Versions are the Git tags of this repository.

## v0.2.0

- People: records synced from Fyso Biz (`"source":"biz"`, written by fyso-ext-biz) are shown read-only with a "Managed by Fyso Biz" label, and a note explains that they come from Fyso Biz access. Edit and Remove refuse a record that is, or has become, managed by Fyso Biz. Manual people keep the current behavior.
- The skill notes that `fyso-people/` mirrors the Biz project's people when the project is connected to Fyso Biz.
- Record parsing moved to `panel/people-record.js`, with unit tests and a CI workflow.

## v0.1.1

- License under the GNU AGPL v3.0; keep the repository LICENSE out of generated projects.
- Use business terms in panel copy.

## v0.1.0

- First independent release of the human requests extension.
