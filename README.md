# MCPGuard — Secure Agent Control Plane


MCPGuard turns four independently tested MCP and LLM infrastructure components
into one runnable product. Its operator interface makes every authorization,
tool call, PII redaction, token reservation, and provider fallback visible.

The product stays deterministic and local-first: mock providers make the full
workflow reproducible without external credentials, while the security,
validation, streaming, and rate-limit paths use the real implementation.

## Product experience

| Screen                     | What it demonstrates                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Agent playground           | Runs one request across authentication, authorization, MCP execution, token admission, routing, and streaming redaction. |
| Security & tool-call trace | Shows role decisions, protected tools, blocked downstream calls, and PII-removal counts.                                 |
| Model usage & routing      | Visualizes the SQLite sliding-window budget, provider health, and controlled fallback behavior.                          |

### Run the complete product

```bash
npm ci
npm run product:dev
```

Open `http://127.0.0.1:5173`. The frontend proxies API calls to the local control
plane on port `4500`.

To run the compiled frontend and API from one process:

```bash
npm run product:build
npm run product:start
```

Then open `http://127.0.0.1:4500`.

## Core infrastructure

The product is built on four TypeScript components:

1. A custom MCP server with strict validation and stdio isolation.
2. An MCP security gateway with Bearer authentication and tool-level authorization.
3. A streaming LLM gateway that redacts PII across partial stream chunks.
4. A token-aware model router with SQLite rate limiting, timeouts, and provider fallback.

The services are independently runnable. Local mock servers keep the examples and test suite deterministic, so no external provider credentials are required to evaluate the project.

## At a glance

| Task      | Component               | Main property                                   |   Tests |
| --------- | ----------------------- | ----------------------------------------------- | ------: |
| 1         | MCP server              | Strict Zod validation and clean stdio transport |      32 |
| 2         | MCP security gateway    | Method-level authorization before proxying      |      28 |
| 3         | Streaming LLM guardrail | Incremental, bounded-memory PII redaction       |      27 |
| 4         | Model router            | Atomic token limiting and controlled failover   |      21 |
| Product   | Integrated runtime      | End-to-end policy and safe-output flows         |       4 |
| **Total** |                         |                                                 | **112** |

## Prerequisites

- Node.js 22.12 or newer
- npm

Task 4 uses Node's built-in `node:sqlite` module. Node 22 may print an experimental-feature warning when SQLite tests run; this is expected and does not indicate a test failure.

## Install and verify

```bash
npm ci
npm run check
```

`npm run check` performs all submission checks in sequence:

1. Prettier formatting verification
2. Strict TypeScript type checking
3. Production build
4. Complete Vitest suite

Expected test summary:

```text
Test Files  12 passed (12)
Tests       108 passed (108)
```

Structured `info` and `error` log lines during the test run are expected. Several tests deliberately exercise rejected requests, failed upstream calls, timeouts, and fallback behavior.

## Useful commands

| Command                 | Purpose                                             |
| ----------------------- | --------------------------------------------------- |
| `npm run check`         | Run formatting, type checking, build, and all tests |
| `npm run build`         | Compile TypeScript into `dist/`                     |
| `npm run typecheck`     | Run TypeScript without emitting files               |
| `npm run format:check`  | Verify Prettier formatting                          |
| `npm run product:dev`   | Run the API and React interface in development      |
| `npm run product:build` | Build the API and production frontend               |
| `npm run product:start` | Serve the compiled product from one process         |
| `npm run test:task1`    | Run Task 1 tests                                    |
| `npm run test:task2`    | Run Task 2 tests                                    |
| `npm run test:task3`    | Run Task 3 tests                                    |
| `npm run test:task4`    | Run Task 4 tests                                    |

## Repository structure

```text
src/
  task1/    MCP customer-service server
  task2/    MCP authorization gateway and downstream mock
  task3/    Streaming PII guardrail and provider mock
  task4/    SQLite rate limiter, model router, and provider mock
tests/
  task1/    Validation, protocol, and stdio tests
  task2/    Authentication, JSON-RPC, and proxy tests
  task3/    Redactor, SSE parser, and streaming gateway tests
  task4/    Rate limiter, provider client, and router tests
package.json
package-lock.json
tsconfig.json
tsconfig.build.json
.gitignore
.prettierignore
```

Generated output and local dependencies are intentionally excluded from version control. Reviewers can recreate them with `npm ci` and `npm run build`.

---

## Task 1 — Custom MCP Server

Task 1 is a runnable MCP server built with the official `@modelcontextprotocol/sdk`. It communicates through `StdioServerTransport` and exposes two customer-service tools.

### Tools

| Tool                  | Input                             | Behavior                                          |
| --------------------- | --------------------------------- | ------------------------------------------------- |
| `get_customer_record` | `customer_id`                     | Returns a record from the mock customer store     |
| `trigger_refund`      | `customer_id`, `amount`, `reason` | Creates a mock refund result for a known customer |

### Validation rules

- `customer_id` must match `^CUST-[A-Z0-9]{5}$`.
- `amount` must be a finite number greater than zero.
- `reason` is trimmed and must contain at least 10 characters.
- Numeric strings are not coerced into numbers.
- Missing, incorrectly typed, and unexpected fields are rejected.
- Input schemas are strict Zod objects.

The assessment describes the ID as `CUST-XXXXX` but does not define `X`. This implementation treats each `X` as one uppercase ASCII letter or digit. For example, `CUST-12345` and `CUST-A1B2C` are valid.

### Protocol behavior

The lower-level MCP `Server` API is used so schema failures can be mapped to the standard JSON-RPC `-32602 Invalid params` error requested by the brief.

A valid request for an unknown customer is different from an invalid protocol request. It returns an MCP tool result with `isError: true` and a business-level `CUSTOMER_NOT_FOUND` code instead of incorrectly reporting a JSON-RPC validation error.

Tool annotations describe the safety properties to capable clients:

- `get_customer_record` is read-only and idempotent.
- `trigger_refund` is destructive and non-idempotent.

### STDIO isolation

For an MCP stdio server, stdout is the protocol channel. One accidental log line can corrupt communication, so application logs write only to `process.stderr`; application code does not use `console.log`.

Logs include the tool name and request ID for traceability, but do not include customer records or refund reasons.

### Run Task 1

After `npm run build`:

```bash
npm run task1:start
```

For development without a separate build step:

```bash
npm run task1:dev
```

The process waits for MCP JSON-RPC messages on stdin. The protocol and stdio tests provide the easiest reproducible client interaction:

```bash
npm run test:task1
```

### Rubric evidence

| Evaluation criterion | Implementation evidence                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| STDIO isolation      | A black-box test spawns the compiled process, parses every stdout line as JSON-RPC, and separately verifies stderr logging.     |
| Protocol compliance  | Integration tests perform MCP initialization, `tools/list`, and `tools/call`, preserve request IDs, and assert `-32602` errors. |
| Validation           | Tests cover malformed IDs, wrong and missing types, extra fields, invalid amounts, whitespace, and reason length.               |

---

## Task 2 — MCP Security Gateway

Task 2 is an HTTP/JSON-RPC reverse proxy between an AI agent and a downstream MCP server. It authenticates each caller, inspects MCP requests, blocks unauthorized administrative tool calls locally, and forwards allowed requests.

### Authorization policy

| Request                 | Admin   | Viewer                  |
| ----------------------- | ------- | ----------------------- |
| `tools/list`            | Forward | Forward                 |
| Regular `tools/call`    | Forward | Forward                 |
| `admin_*` `tools/call`  | Forward | Return `-32001` locally |
| Other valid MCP methods | Forward | Forward                 |

The brief requires transparent `tools/list` forwarding, so administrative tools remain visible in the downstream list. Authorization is enforced when a tool is called.

The blocked response preserves the original JSON-RPC request ID:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32001,
    "message": "Unauthorized Tool Call"
  }
}
```

### Authentication design

Bearer tokens are resolved to either `admin` or `viewer` through a `TokenVerifier` interface. The runnable implementation reads:

- `GATEWAY_ADMIN_TOKEN`
- `GATEWAY_VIEWER_TOKEN`

Development defaults are `dev-admin-token` and `dev-viewer-token`.

The role is not trusted from a client-controlled field in the JSON-RPC body. For production, the static verifier can be replaced with a JWT/OIDC verifier without changing the proxy's authorization logic.

### Proxy and error behavior

- Malformed JSON returns `-32700 Parse error`.
- Invalid JSON-RPC envelopes return `-32600 Invalid Request`.
- Invalid `tools/call` parameters return `-32602 Invalid params`.
- Unauthorized `admin_*` calls return `-32001 Unauthorized Tool Call` without contacting the downstream server.
- Missing or unknown credentials receive HTTP 401 with a sanitized gateway authentication error.
- Downstream failures receive a sanitized HTTP 502 / JSON-RPC `-32603` response.
- Allowed request bytes are forwarded unchanged after inspection.
- The caller's gateway `Authorization` header and hop-by-hop headers are not sent downstream.
- Downstream status, response body, and end-to-end headers are preserved.
- Request bodies are limited to 1 MiB and downstream calls have a bounded timeout.

### Run Task 2

Build once, then start the mock downstream server:

```bash
npm run task2:mock:start
```

In a second terminal, start the gateway:

```bash
npm run task2:gateway:start
```

Default endpoints:

- Downstream mock: `http://127.0.0.1:4101/mcp`
- Security gateway: `http://127.0.0.1:4100/mcp`

Try an administrative tool as a viewer:

```bash
curl -sS http://127.0.0.1:4100/mcp \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer dev-viewer-token' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"admin_reset_key","arguments":{}}}'
```

Run only the Task 2 tests:

```bash
npm run test:task2
```

### Rubric evidence

| Evaluation criterion       | Implementation evidence                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| JSON-RPC parsing           | Unit tests cover valid envelopes, IDs, parse errors, invalid requests, and malformed tool parameters.       |
| Reverse proxying           | HTTP integration tests verify request bytes, headers, status codes, and downstream responses.               |
| Fine-grained authorization | Tests cover both roles, regular tools, `admin_*` tools, and invalid credentials.                            |
| Clean error handling       | Tests assert exact client-safe errors and ensure internal addresses and connection messages are not leaked. |

The downstream mock records received requests, allowing the unauthorized-call test to prove its request count remains zero.

---

## Task 3 — Streaming LLM PII Guardrail

Task 3 is an OpenAI-compatible streaming gateway. It sends a text-generation request to an LLM provider, incrementally parses the provider's Server-Sent Events (SSE), redacts sensitive text, and streams safe deltas to the client.

### Streaming pipeline

```text
Provider bytes
  -> incremental UTF-8 decoding
  -> SSE event parsing
  -> provider delta extraction
  -> bounded PII redaction
  -> safe SSE output
```

Network chunks and model deltas can split sensitive values at any character. The implementation therefore carries only the unresolved suffix needed to determine whether the next characters complete a protected pattern.

It detects and replaces these values with `[REDACTED]`:

- Email addresses
- Nine-digit SSNs in compact, spaced, or hyphenated form
- Credit-card-shaped values containing 13–19 digits, with optional spaces or hyphens

Card-shaped values are redacted conservatively without requiring a valid Luhn checksum. For a data-loss-prevention guardrail, avoiding exposure is more important than accepting a synthetic or mistyped number.

### Latency and memory behavior

- The full provider response is never accumulated in memory.
- The redactor's unresolved suffix is capped at 320 characters.
- The unfinished SSE event buffer is bounded at 262,144 characters.
- Safe text is emitted as soon as it can no longer become part of a PII match.
- Response writes honor Node.js backpressure.
- Client disconnects abort the provider request.
- `Cache-Control: no-transform` and `X-Accel-Buffering: no` discourage intermediary buffering.
- Malformed provider events fail closed with a sanitized SSE error.
- Logs record only redaction counts and peak buffer size, never generated text.

### Run Task 3

Start the mock streaming provider:

```bash
npm run task3:mock:start
```

In a second terminal, start the gateway:

```bash
npm run task3:gateway:start
```

Default endpoints:

- Mock provider: `http://127.0.0.1:4201/v1/chat/completions`
- Guardrail gateway: `http://127.0.0.1:4200/v1/chat/completions`

For a real provider, configure `LLM_PROVIDER_URL` and, when required, `LLM_PROVIDER_API_KEY`.

Use curl with response buffering disabled:

```bash
curl -N http://127.0.0.1:4200/v1/chat/completions \
  -H 'Content-Type: application/json' \
  --data '{"model":"mock","stream":true,"messages":[{"role":"user","content":"Give me the example"}]}'
```

Run only the Task 3 tests:

```bash
npm run test:task3
```

### Rubric evidence

| Evaluation criterion     | Implementation evidence                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| Async stream chunking    | Integration tests consume a real HTTP stream and confirm safe output arrives before provider completion. |
| Partial-pattern matching | Tests split every supported PII form at every possible character boundary.                               |
| Buffer management        | An adversarial 10,000-character input proves retained redactor state stays at or below its fixed cap.    |
| Memory efficiency        | SSE parsing and redaction are incremental; neither stores the complete response.                         |
| Low latency              | Unambiguous safe text is emitted immediately, with backpressure-aware writes and anti-buffering headers. |

---

## Task 4 — Rate Limiter and Model Fallback Router

Task 4 is an HTTP model router for completion requests. It enforces a persistent per-tenant token budget, calls a primary provider, and performs one controlled fallback to a secondary provider when the primary is rate-limited or exceeds its deadline.

Supported routes:

- `/v1/completions`
- `/v1/chat/completions`

Tenant credentials can be supplied through `X-API-Key` or a Bearer token.

### Token-aware sliding window

The default limit is 50,000 estimated tokens per tenant in an exact rolling 60-second window.

Before contacting a provider, the router reserves estimated input tokens plus the requested maximum output tokens. Reserving possible output up front prevents concurrent requests from each observing the same unused budget and oversubscribing the tenant.

The provider-neutral estimator uses UTF-8 byte length plus message overhead. It implements a `TokenEstimator` interface so an exact model tokenizer can be injected in a production deployment.

### SQLite consistency

Rate-limit events are stored in an on-disk SQLite database at `./data/task4-rate-limits.sqlite` by default. The raw tenant API key is never stored; the database uses its SHA-256 digest.

Each admission decision runs in one `BEGIN IMMEDIATE` transaction:

1. Evict events outside the active window.
2. Sum active reservations for the tenant.
3. Reject the request if the proposed total exceeds the limit.
4. Otherwise insert the reservation and commit.

This makes eviction, checking, and reservation atomic across concurrent requests and across multiple router processes sharing the database. SQLite WAL mode and a tenant/time index keep transactions short and lookups focused.

Rejected requests are not inserted. `Retry-After` is calculated from the point at which enough reserved tokens will have expired, rather than simply using the oldest event.

### Fallback policy

| Primary result                       | Router behavior                                    |
| ------------------------------------ | -------------------------------------------------- |
| Successful response                  | Return primary output                              |
| HTTP 429                             | Cancel the primary body and try the secondary once |
| Exceeds 3,000 ms                     | Abort the primary and try the secondary once       |
| Other HTTP, network, or format error | Return a sanitized gateway error without fallback  |

The 3,000 ms deadline covers both response headers and the complete response body. A provider cannot bypass the timeout by sending headers and then stalling. The secondary request has the same bounded deadline, and an aborted late primary response cannot replace the selected fallback result.

Fallback is intentionally limited to the two conditions required by the assessment. Retrying permanent errors such as invalid credentials could hide a configuration problem and create unnecessary provider traffic.

### Standardized errors and safety

Gateway failures use one client-safe structure:

```json
{
  "error": {
    "code": "UPSTREAM_ERROR",
    "message": "No model provider could complete the request",
    "request_id": "request-123"
  }
}
```

- Raw provider bodies, internal URLs, exception messages, and stack traces are never returned.
- Tenant credentials are not forwarded to model providers.
- Separately configured provider credentials are injected per provider.
- Request and provider-response bodies are size bounded.
- Client disconnects abort the active provider request.
- Logs omit API keys, prompts, and raw provider errors.
- Successful responses include `X-Gateway-Provider: primary` or `secondary` for routing visibility.

### Run Task 4

Start the combined mock providers:

```bash
npm run task4:mock:start
```

In a second terminal, start the router:

```bash
npm run task4:router:start
```

Default endpoints and storage:

- Router: `http://127.0.0.1:4400`
- Mock providers: `http://127.0.0.1:4401`
- SQLite database: `./data/task4-rate-limits.sqlite`

The mock primary intentionally returns HTTP 429 so the default demonstration exercises secondary fallback.

Send a completion request:

```bash
curl -sS http://127.0.0.1:4400/v1/completions \
  -H 'Content-Type: application/json' \
  -H 'X-API-Key: tenant-demo-key' \
  --data '{"prompt":"Explain resilient routing","max_tokens":100}'
```

Configure real providers with:

- `PRIMARY_MODEL_URL`
- `PRIMARY_MODEL_API_KEY`
- `SECONDARY_MODEL_URL`
- `SECONDARY_MODEL_API_KEY`

Additional controls include `RATE_LIMIT_DB_PATH`, `TOKEN_LIMIT_PER_MINUTE`, `RATE_LIMIT_WINDOW_MS`, and `PROVIDER_TIMEOUT_MS`.

Run only the Task 4 tests:

```bash
npm run test:task4
```

### Rubric evidence

| Evaluation criterion    | Implementation evidence                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Async concurrency       | Concurrent HTTP tests race 20 requests for one tenant and prove only reservations within the limit reach a provider. |
| Timeout races           | Tests cover stalled response bodies and prove late primary output cannot replace secondary output.                   |
| Sliding-window eviction | Deterministic-clock tests cover exact cutoff behavior, tenant isolation, rejected reservations, and retry timing.    |
| Token tracking          | Reservations are atomic, persisted on disk, and shared correctly by independent SQLite connections.                  |
| Graceful fallback       | Integration tests cover primary success, primary 429, timeout, one fallback attempt, and secondary failure.          |
| Error sanitization      | Tests place secrets and internal addresses in upstream errors and confirm none are returned to clients.              |

---

## Test strategy

The suite combines unit, integration, concurrency, and black-box process tests:

- Pure validation and parsing tests cover malformed and boundary inputs.
- MCP integration tests use the official client and in-memory transport.
- The stdio test spawns the compiled MCP server as a child process.
- Gateway tests start real HTTP servers on ephemeral ports.
- Streaming tests vary both byte and model-delta boundaries.
- Rate-limiter tests use deterministic clocks and multiple SQLite connections.
- Router tests exercise concurrent admission, hard deadlines, fallback, and sanitized failures.

The mocks are instrumented so tests can assert not only the response, but whether a protected downstream or provider request was actually made.

## Assumptions and production extensions

This repository focuses on the behavior requested by the assessment. The following boundaries are deliberate:

- Customer lookup and refund execution are mock domain operations; a production service would call authenticated CRM and payment APIs and add idempotency controls.
- Task 2 uses static opaque development tokens behind an injectable verifier; production authentication should validate signed JWTs or use token introspection.
- Task 3 uses regex-based PII detection. Production policy may require configurable detectors, organization-specific identifiers, Unicode-aware matching, and measured false-positive thresholds.
- Task 4's default token estimate is provider-neutral. Production deployments should inject the tokenizer used by the selected model.
- On-disk SQLite satisfies the single-host persistence requirement. A horizontally distributed or multi-region gateway would normally use a shared transactional rate-limit store.

These extensions can be added without changing the core protocol, authorization, streaming, or routing boundaries demonstrated here.
