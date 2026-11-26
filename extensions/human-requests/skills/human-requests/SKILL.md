---
name: human-requests
description: Ask a person outside this conversation, or leave a decision for later, using the project's human requests workflow.
---

# Human requests

For a reversible choice, proceed on an explicit, recorded assumption and tell the person. Create a request when the action cannot be undone or the person's answer changes the work. Never treat delivery or viewing as approval.

## What the person must be able to read

The person answers from the Pending page without opening anything else, and rarely answers at once. Write for them. A request is one JSON object, the `REQUEST` parameter, and it is refused when a required field is missing:

| Field | Required | Content |
|---|---|---|
| `title` | yes | The question in one line (120 characters). It is what the person sees in the list |
| `requester` | yes | Your name as the person knows you |
| `doing` | yes | What you were doing when the question came up |
| `needs` | yes | What exactly you need from them, and why you cannot decide alone |
| `if_silent` | yes | What happens if nobody answers |
| `blocked` | no | What is on hold meanwhile |
| `options` | no | 1 to 8 choices, each `{"choice": "...", "effect": "..."}`: what the choice is and what it causes |
| `recommendation` | no | The `choice` you would take |
| `links` | no | Up to 8 `{"label": "...", "url": "https://..."}` to material worth opening |

Include only facts you know; say when information is missing. No secrets, no unnecessary personal data. Never describe a proposed operation as completed before it runs.

## Creating one

Use the Dagu MCP to start the root workflow `ext-human-requests-request` with a stable run ID of your own (reuse it on a retry) and these parameters: `REQUEST`, `RECIPIENT`, `BLOCKING` (`"true"` when work is on hold), `ORIGIN_TYPE` and `ORIGIN_REF`. In the MCP `params` object, encode `REQUEST` as a JSON **string**, not a nested object: Dagu converts nested objects to a non-JSON representation. Encode `ORIGIN_REF` as a JSON string too when using `omb`.

Run labels carry what lists and validation read. They accept only `a-z A-Z 0-9 - _ . /`, are visible in run lists and must hold nothing sensitive:

- `assignee=<recipient>`: `team`, or a person's stable ID. Look the person up in the Dagu wiki under `fyso-people/` and use the UUID; a name with accents or spaces is not a valid label. When the project is connected to Fyso Biz, that directory also mirrors the people with access to the Biz project (records with `"source":"biz"`); their IDs work the same way, and they are managed in Fyso Biz, not here.
- `blocking=true` when `BLOCKING` is `"true"`. It is what the panel's counter highlights.
- `deadline=<Unix seconds>` for an expiry, at most one.
- `choices-hex=<hex>` when you give `options`: the JSON array of the `choice` strings, in the same order, as lowercase hexadecimal UTF-8. It is the authority answers are checked against, and the request is refused if it differs from `options`.

Check that the run reached the waiting state before telling anyone a request exists. A run that failed at `prepare` was refused: read its error, fix the request and start a new one.

## Where the answer goes

- `ORIGIN_TYPE=omb` with `ORIGIN_REF` as JSON holding your exact `bot` and `task` IDs: the decision arrives as a message in this conversation. Do not invent a conversation ID. This is also what lets the person ask you a question first.
- `ORIGIN_TYPE=none`: the answer stays in the run; read the run and its outputs with Dagu.
- `ORIGIN_TYPE=http`: only the operator-configured exact HTTPS endpoint, whose receiver enforces the idempotency contract in `extensions/human-requests/HTTP.md`. The run ID must be globally unique and stable across retries.

## When the person asks you something first

Before deciding, the person may send a clarifying question. It arrives in this conversation as a message saying so. Answer the question in a few sentences from what you know. **Do not act on the request**: it is still open and nothing was decided. Your reply is shown to the person next to their question.

## After the answer

A decision arrives as JSON with `decision` (`answered`, `cancelled` or `expired`), `answer`, `comment` and `responder`. The responder's name is self-declared and proves nothing. Cancellation and expiry are not approval. If the situation changed while you waited, review it before acting. A retried delivery can reach you twice: check what you already did before repeating an action.

This feature must not be used for sensitive approvals without a separately enforced identity and authorization boundary. See `extensions/human-requests/docs/approval-case.md` for a complete test-only scenario.
