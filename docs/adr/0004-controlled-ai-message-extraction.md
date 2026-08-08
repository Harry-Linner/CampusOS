# ADR-0004: Controlled AI Message Extraction

**Status:** Accepted

**Date:** 2026-08-08

**Depends on:** [ADR-0002](0002-user-facing-plugin-modules.md)

## Context

The first AI Assistant implementation binds every Key and model to the OpenAI
Responses endpoint and converts one submitted message into one new task. That
shape cannot represent a provider such as DeepSeek, a message containing several
actions, a correction or cancellation, or the provenance required to explain
and deduplicate a result. A successful fixed-text health check also does not
prove that a Key/model pair can produce the structured extraction the module
requires.

The input is untrusted personal communication. CampusOS must not grant it tool
access, silently write model output, retain raw remote responses, or expand the
existing explicit-submission boundary into background capture.

## Decision

1. AI connections are versioned profiles containing provider, protocol, Base
   URL, encrypted Key, and model. Provider adapters own authentication, model
   discovery, request shape, response parsing, and upstream error translation.
2. Connection testing runs a fixed, non-private extraction fixture through the
   same structured-generation path used by message parsing. Listing models is a
   separate optional capability; a failed model-list request does not prove that
   inference is unavailable.
3. Message extraction returns a versioned envelope containing zero or more
   `create`, `update`, or `cancel` intents and unresolved questions. The model
   cannot write Schedule data.
4. Every extracted field carries confidence, explicit/inferred/default origin,
   confirmation state, and an exact source span when its quoted evidence occurs
   in the submitted text. Ungrounded evidence is discarded and forces
   confirmation.
5. Relative time is resolved against the source message timestamp when one is
   available. Falling back to parse time is recorded and time fields remain
   confirmation-required.
6. Unknown duration remains `null` in extraction. Schedule application policy,
   not the model, supplies any default needed by the current task contract.
7. A commit boundary performs entity resolution, duplicate detection, conflict
   checks, and the final Schedule mutation after explicit user confirmation.
   Source fingerprints stay local and raw source text is not persisted in task
   records.
8. The first V2 delivery supports explicit pasted text. Desktop-pet drag/drop,
   OCR, clipboard monitoring, and WeChat/DingTalk integrations remain separate
   later decisions with their own consent and compliance review.

## Architecture

```text
explicit message + source metadata
              |
              v
Provider Adapter -> structured candidate envelope
              |
              v
Extraction validation -> evidence grounding -> editable review
              |
              v
Commit boundary -> fingerprint/entity/conflict checks -> Schedule IPC
```

Core owns connection secrets, provider transport, validation, fingerprints, and
commit policy. The official AI Assistant plugin owns configuration and review
UI. Schedule remains the only task store.

## Alternatives Considered

### Keep one OpenAI-compatible request path

Rejected because compatible providers differ in Base URL, authentication,
model discovery, structured-output features, and response envelopes. Treating a
model name as a provider selection caused valid DeepSeek credentials to be sent
to OpenAI.

### Let the model call Schedule tools directly

Rejected because message text is untrusted, model output is probabilistic, and
updates/cancellations require deterministic matching and user review.

### Add regex/date-parser fallback

Rejected for product scope and ambiguity reasons. Deterministic code validates
and grounds model output but does not create a competing semantic parser.

## Consequences

- Provider support and extraction schemas can evolve independently.
- One message can yield several reviewable actions without a second task store.
- Users can inspect where every important value came from and repeated imports
  can be blocked locally.
- The implementation becomes larger and requires provider contract fixtures,
  schema migrations, prompt/schema versioning, and extraction-quality tests.
- Provider capability differences remain visible; CampusOS must report an
  unsupported capability rather than fabricate compatibility.

## Migration

Stored V1 settings migrate to an OpenAI profile with the official Base URL and
the existing encrypted Key. Existing local tasks remain valid. V2 provenance
fields are optional on historical task records, while newly committed assistant
tasks include a source fingerprint and structured course reference when known.

## Validation Criteria

- OpenAI Responses, OpenAI-compatible/DeepSeek Chat Completions, Anthropic
  Messages, and Gemini Generate Content fixture adapters send requests to their
  configured hosts and parse their documented envelopes.
- A connection test proves the selected model returns the required structured
  envelope, not merely arbitrary text.
- Multi-intent, missing-time, relative-time, ungrounded-evidence, duplicate, and
  update/cancel cases have formal tests.
- The renderer displays multiple editable candidates and exact evidence without
  saving until confirmation.
- No Key, raw response, raw private message, or private source metadata appears
  in logs, diagnostics, screenshots, Git, or CI output.

## References

- [Google LangExtract](https://github.com/google/langextract)
- [Microsoft TypeChat](https://github.com/microsoft/TypeChat)
- [Vercel AI SDK](https://github.com/vercel/ai)
- [Open WebUI provider configuration](https://docs.openwebui.com/getting-started/quick-start/connect-a-provider/starting-with-openai-compatible/)
- [Chatbox provider architecture](https://github.com/chatboxai/chatbox/blob/main/docs/adding-provider.md)
