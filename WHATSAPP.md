# WhatsApp production messaging

## Approved template

- Name: `crm_followup_reminder`
- Language: `fr`
- Category: `MARKETING`
- Body variable `{{1}}`: contact first name

The approved body, footer, and Call on WhatsApp button are stored and rendered
by Meta. The API sends only the approved template identity and the value for
`{{1}}`.

## Safety switches

Keep both automation switches disabled during deployment:

```env
WHATSAPP_SEND_ENABLED=false
FOLLOWUP_CRON_ENABLED=false
WHATSAPP_ALLOW_FREEFORM_MESSAGES=false
```

`WHATSAPP_SEND_ENABLED` is the master outbound switch. A lead must additionally
have `whatsapp_opt_in=true` and no `whatsapp_opt_out_at` value. Free-form
messages remain disabled because they are valid only during an open customer
service window.

## Controlled first test

1. Apply migrations and deploy while both switches remain false.
2. Create a lead for a number controlled by the operator with explicit
   `whatsapp_opt_in: true`.
3. Configure the permanent token and Phone Number ID in the hosting environment.
4. Set `WHATSAPP_SEND_ENABLED=true`, restart, and create only the test lead.
5. Confirm Meta returns a `wamid` and that the message arrives.
6. Set `WHATSAPP_SEND_ENABLED=false` again until webhook status processing has
   been deployed and verified. STOP processing is still not implemented.

Never commit or paste the permanent access token into source code, logs, or
support messages.

## Secure Meta webhook receipt

The callback URL configured in the Meta application is:

```text
https://api.cv-pam.com/api/webhooks/whatsapp
```

Required hosting variables:

```env
WHATSAPP_APP_SECRET=<Meta App Secret>
WHATSAPP_WEBHOOK_VERIFY_TOKEN=<independent random verification token>
```

The verification token is chosen by the operator and entered identically in
Meta and Hostinger. The App Secret comes from the Meta application. Neither
value belongs in source control.

Meta validates the callback with `GET`. The API accepts only
`hub.mode=subscribe`, compares the verification token safely, and returns the
exact `hub.challenge`. Missing request parameters return `400`; a rejected mode
or token returns `403`.

Webhook notifications arrive by `POST`. The API keeps the exact request bytes
(JSON bodies are limited to 100 KB), validates `X-Hub-Signature-256` using HMAC
SHA-256 and `WHATSAPP_APP_SECRET`, then stores one idempotent receipt in
`whatsapp_webhook_events`. Missing, malformed, or invalid signatures return
`401`. A missing server-side secret returns `503` and prevents persistence.

## Meta delivery status processing

After secure receipt, every object under `entry[].changes[].value.statuses[]`
is processed independently. The supported progression is:

```text
accepted < sent < delivered < read
```

- `accepted` is recorded from Meta's successful HTTP send response. It only
  confirms that Meta accepted the request; the `FollowUp` remains `processing`.
- `sent` comes from a signed webhook and records `sent_at`. It is not final
  delivery success, so the `FollowUp` remains `processing`.
- `delivered` records `delivered_at` and is the exact point where the
  `FollowUp` becomes `completed`.
- `read` records `read_at`; a completed follow-up remains completed.
- `failed` records `failed_at` and useful Meta error details, then marks the
  `FollowUp` failed. A late failure cannot replace an already delivered or read
  state.

Status rank and Meta timestamps prevent delayed notifications from regressing a
more advanced state. A missing timestamp uses the webhook receipt time and this
fallback is recorded in the processing summary. An invalid timestamp is audited
without writing an invalid date or blocking other valid statuses in the same
payload.

Idempotence exists at two levels: the raw webhook receipt has a unique stable
event key, and every status object has a deterministic processed key within that
receipt. Repeated deliveries return HTTP `200` without duplicating or rewriting
`Message` or `FollowUp` rows.

An unknown `wamid` is counted as unmatched in `whatsapp_webhook_events`; it does
not create a Message. If a FollowUp can still be identified by its provider
message ID while its Message row is missing, it moves to `needs_review`.
Receipts end in `processed`, `partially_processed`, `ignored`, or `failed`, with
counts and a compact audit summary.

## Inbound messages and opt-out

Signed webhook payloads may contain several messages, several statuses, or both.
Text messages are stored once by Meta `wamid`, with direction `inbound`, the
normalized source phone, Meta timestamp, message type, text, optional context,
and a reference to the webhook receipt. The complete payload remains only in
`whatsapp_webhook_events`; it is not duplicated into each Message row.

Phones are normalized to 7-15 international digits by removing only spaces,
parentheses, hyphens, and the leading `+`. No country prefix is invented. The
lookup checks Lead first and Student second. If both types share a phone, Lead
wins because no cross-model relationship currently exists. Unknown contacts are
not created; their inbound Message remains auditable without a contact link.

The exact normalized opt-out keywords are:

```text
STOP
ARRET / ARRÊT
PA STOP
SISPANN
UNSUBSCRIBE
```

The explicit sentence `Tanpri stop voye mesaj sa yo` and equivalent anchored
forms are also recognized. Matching ignores case, accents, and extra outer
spaces. It intentionally does not search for `stop` anywhere in a sentence:
`Pa stop travay la` is not an opt-out. This conservative rule limits false
positives.

An opt-out sets `whatsapp_opt_in=false`, records the first withdrawal date and
source `inbound_whatsapp`, preserves the historical opt-in date, and writes a
`WhatsAppConsentEvent` linked to the inbound `wamid` and webhook. Duplicate
delivery of the same Meta message does not duplicate Message or consent proof.
A later STOP can add a new proof but does not overwrite the first withdrawal
date.

A normal inbound message never enables opt-in. Re-subscription is available
only through the service method `recordExplicitOptIn`, which requires an
authenticated actor or explicit external evidence, plus source, date, and
context. There is no automatic START keyword.

## Strict outbound consent policy

`canSendWhatsApp(contact, category)` is used for initial Lead messages,
follow-ups, group messaging, and Student activation/recovery. All categories,
including utility/service, are currently blocked unless:

- `whatsapp_opt_in=true`;
- `whatsapp_opt_in_at` exists;
- `whatsapp_opt_out_at` is null.

An opt-out returns `skipped_opt_out` before any Meta request. A blocked follow-up
is cancelled and moved to `needs_review`; it is never marked completed. Group
and recovery results expose the same explicit skip status. A separate service
message exception may be designed later, but none is authorized now.

Authenticated Lead and Student creation forms require a non-empty consent source
when opt-in is selected. The contact consent fields and the corresponding
`WhatsAppConsentEvent` are written together in the same database transaction.

Initial, follow-up, group, and activation/recovery sends record a `Message` and
durable `delivery_evidence`. `accepted` means that Meta returned a `wamid`; it
does not mean delivered. A FollowUp becomes `completed` only after a signed
`delivered`/`read` webhook or an audited manual decision.

## Personal data and retention

Stored inbound data includes the normalized sender phone, message text, Meta
message ID and timestamp, minimal context/profile/metadata audit fields, and the
signed webhook payload. Consent evidence records contact identity, normalized
phone, action, source, event time, processing time, and supporting context.

There is currently no automatic deletion. As an initial operational target,
retain message bodies and raw webhook payloads for no more than 12 months unless
a documented support, contractual, or legal need requires longer. Consent and
withdrawal proof should be retained for the active relationship plus the period
approved by the organization's legal/privacy owner. These periods must be
validated before implementing an automated purge; no bulk purge is part of this
phase.

Keep `WHATSAPP_SEND_ENABLED=false` and `FOLLOWUP_CRON_ENABLED=false` until a
separate controlled production activation decision.

## Stuck follow-up recovery

`processing` means a worker has atomically claimed the FollowUp and may be in
the send path. `needs_review` means automation has stopped because delivery
cannot be decided safely. The default timeout is 15 minutes and is controlled
by:

```env
FOLLOWUP_PROCESSING_TIMEOUT_MINUTES=15
FOLLOWUP_RECOVERY_BATCH_SIZE=50
FOLLOWUP_MAX_ATTEMPTS=3
```

At claim time, `delivery_evidence=no_meta_request` is persisted. Immediately
before the Meta call it becomes `meta_request_started`, and after a response
with `wamid` it becomes `meta_accepted`. A legacy/null evidence value is treated
as ambiguous. This ordering means automatic recovery returns to `pending` only
when durable evidence proves the request never started. The claim-only attempt
is then removed from `attempt_count`.

Recovery classification is conservative:

- Message `delivered` or `read`: reconcile to `completed`;
- Message `failed`: reconcile to `failed`;
- current opt-out: cancel and move to `needs_review` with `contact_opted_out`;
- maximum attempts: `needs_review` with `maximum_attempts_reached`;
- `wamid` without terminal status: `needs_review` with
  `meta_status_missing_after_timeout`;
- missing `wamid` after a started/unknown request: `needs_review` with
  `ambiguous_delivery_result`;
- durable `no_meta_request`: return to `pending` without sending immediately.

No recovery or review endpoint sends a WhatsApp message. A delayed signed
webhook may still move `needs_review` to `completed` or `failed`.

Admin endpoints:

```text
GET   /api/followups/review?page=1&limit=50
POST  /api/followups/recovery/run
PATCH /api/followups/:id/review
```

Start with a dry-run:

```json
{ "dry_run": true, "limit": 50 }
```

Manual decisions are `mark_completed`, `mark_failed`, `return_to_pending`, and
`cancel`. Every decision requires an admin JWT, a non-empty note, confirmation
in the UI, and an AuditLog containing the actor and state transition.
`return_to_pending` is refused for ambiguous/wamid deliveries, invalid or
withdrawn consent, delivered/read messages, maximum attempts, or missing
`no_meta_request` evidence.
