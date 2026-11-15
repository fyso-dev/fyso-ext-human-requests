# Experimental HTTP return contract

Status: local prototype only; no real external receiver has been validated. The default destination is empty and requests with an HTTP origin fail closed. The caller supplies an exact URL as `ORIGIN_REF`, but it must match the project operator's configured destination. This is a configuration guardrail; under D40, trusted project operators already have broad command execution and it is not a per-user authorization boundary.

## Configuration

In the project-owned `project/workflows/ext-human-requests-request.yaml`, set two native Dagu environment variables in the delivery step. This example uses a fictional host:

```yaml
- FYSO_HR_HTTP_DESTINATION: 'https://receiver.example/callback'
- FYSO_HR_HTTP_SECRET_NAME: 'FYSO_HR_HTTP_RECEIVER'
```

Store the endpoint's bearer value in `secrets.enc.yaml` under its named key using the project's normal SOPS workflow; do not place it in the workflow, URL, prompt or parameters. Names must start with `FYSO_HR_HTTP_` followed by uppercase ASCII letters, numbers or underscores. Only one destination is configured per project workflow; another program requires an explicit configuration change and its own credential. Requests already waiting retain the workflow definition captured at their start; changing the endpoint does not redirect those runs. Dagu's process needs the existing project-root and age-key environment used by the framework's process-side Composio integration, and `sops` must resolve to a working executable. No API key is exposed to the page or embedded in the response log.

Only the exact configured URL, including path and port, is allowed. HTTPS and certificate verification are mandatory; URL credentials, query strings and fragments are rejected. By default, IP literals and DNS results that are private, loopback, link-local, multicast, special or mixed public/private are rejected. The vetted address is pinned for the actual connection. Redirects are rejected.

### Optional exact private address

For a local or private HTTPS receiver, a project operator may explicitly opt in to **one exact IP address**, in the same delivery step:

```yaml
- FYSO_HR_HTTP_PRIVATE_ADDRESS: '127.0.0.1'
```

The caller's URL must still equal `FYSO_HR_HTTP_DESTINATION`. If that URL uses a hostname, every resolved address must equal the configured IP; mixed or changed DNS results are rejected and the connection is pinned to that IP. A literal IP in the destination is accepted only when it equals the configured IP. The accepted private ranges are RFC1918, CGNAT and IPv6 ULA, plus the exact loopbacks `127.0.0.1` and `::1`. CIDRs, IPv4-mapped IPv6, multicast, unspecified, link-local, AWS IPv6 metadata range `fd00:ec2::/32`, and `100.100.100.200` are rejected even with opt-in. Hostnames that resolve to both IPv4 and IPv6 loopback must be made unambiguous; a literal IP is one option.

**HTTPS is still required for loopback and private addresses. Plain HTTP on localhost is not supported.** Node must trust the receiver's certificate and the certificate must match the destination hostname or IP subject alternative name; this setting never disables certificate verification. For a self-signed local service, configure Node's trusted CA separately and verify it in the deployment. The operator is authorizing this exact host and port to receive the bearer and response data; the IP pin cannot establish that a service on that address is trustworthy. This mode is a routing guardrail for trusted project operators, not a boundary against other users who already have Dagu execution privileges.

## Receiver obligations

The extension POSTs a JSON object with request ID, question (the request's title), answer, comment, responder and decision. All included data is delivered to the configured receiver; the person configuring the destination is responsible for permitting that disclosure. The request includes `Authorization: Bearer <secret>` and a deterministic `Idempotency-Key` derived from project and run IDs. Project names are not globally unique: callers must choose run IDs that are unique across all installations sending to the same receiver (for example, UUIDs), and reuse the same ID only for the same request. The destination must:

1. Authenticate the bearer and validate the payload.
2. Atomically persist the key and associated payload with its effect. A replay with the same key and identical body must return the original result without repeating the effect; the same key with a different body must be rejected.
3. Return a 2xx response with the identical `Idempotency-Key` response header when the operation has been accepted. Redirects, other status codes and missing or incorrect acknowledgement leave the delivery step failed.

The sender does not log response content, destination, bearer or payload. Timeouts and transport failures are uncertain: the receiver may already have acted. Retrying is safe only when that receiver actually implements the contract above. An echoed header is a protocol acknowledgement, not proof of atomic or idempotent receiver behavior.

## Local tests and limits

`tests/human-requests-http-return.test.cjs` covers allowlisting, credentials, public/private DNS restrictions, exact-IP matching, metadata exclusions, pinned lookup, exact acknowledgement and stable keys with simulated dependencies. `tests/human-requests-http-tls.test.cjs` has two loopback TLS fixtures: a test-only public-to-loopback adapter verifies receiver deduplication; a private opt-in uses the real pinned address and checks correct and incorrect certificate names, an untrusted CA, and IP SAN. Neither validates real external DNS/network policy, real receiver guarantees or the full workflow. `tests/human-requests-http-sops.test.cjs` requires the pinned executable paths in `FYSO_TEST_AGE_KEYGEN` and `FYSO_TEST_SOPS` and verifies extraction from a temporary encrypted fixture without exposing its values.
