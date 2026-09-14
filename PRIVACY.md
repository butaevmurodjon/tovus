# Privacy

## What the bot stores during normal operation

| Data | Where | Retention |
|---|---|---|
| Group settings, admin list, member counts | Redis | until the bot is removed from the group |
| Deleted-message journal (text, sender name/id, reason) | Redis | last 300 entries per group |
| Recent message text + sender id/username (for "who posted this" / ban cleanup) | Redis | 30 days |
| Aggregate counters (message counts, violation counts, hourly activity) | Redis | 90 days |
| User reputation score (per group) | Redis | 30 days of inactivity |
| Daily-summary buffer (sender display name + text) — only groups with `dailySummaryEnabled` AND owner approval | Redis | 48 hours, auto-expiring |

No message content is sent to third parties except:
- messages a **premium**-mode group explicitly opts into having classified by
  the DeepSeek API (only borderline cases are sent; DeepSeek's data-retention
  terms apply);
- with **OCR** turned on for a group, its photo messages are sent to the
  OCR.space API to read text embedded in the image;
- with the **daily AI summary** turned on for a group (see below — requires a
  second, bot-owner-only approval per group), that day's chat text is sent to
  the DeepSeek API to generate the summary.

## OCR text recognition (optional, off by default)

When a group admin enables `ocrEnabled`, photo messages in that group are sent
to the OCR.space API (a third party, not DeepSeek) to extract any text baked
into the image, which is then checked by the same spam/profanity filters as
ordinary message text. The photo itself is downloaded via the Bot API and
forwarded to OCR.space as image data — Telegram's own file URL (which embeds
this bot's token) is never shared with OCR.space. No separate retention beyond
what OCR.space's own terms specify for the API call itself; this bot does not
additionally store the photo.

## Daily AI chat summary (optional, off by default, per-group owner approval required)

When a group admin enables `dailySummaryEnabled` **and** the bot owner has
separately allowed it for that specific group, the bot buffers that day's
message text (sender display name + text, capped in length and count) for up
to 48 hours, sends it to the DeepSeek API once per day to generate a short
summary, and posts the summary back to the group. The buffer is transient —
capped and expiring automatically — not part of the longer-retention corpus
below. This is a materially bigger single disclosure than the premium/OCR
paths above (a whole day's conversation, not one message or photo at a time),
which is why it requires the bot owner's explicit per-group approval on top of
the group admin's own toggle, not just the admin's.

## Training-corpus collection (optional, off by default)

When the operator enables `CORPUS_ENABLED`, the bot additionally retains a
sample of messages from moderated groups — **raw text together with the
sender's Telegram id, username and display name** — to build a labelled dataset
for improving spam / scam / profanity detection. On this sample:

- A small fraction of non-premium traffic may be sent to the DeepSeek API for a
  shadow classification whose result is logged but **never enforced**.
- Admin actions (`/spam`, `/ham`, restoring a deleted message, manually banning
  a member) attach a confirmed label to the corresponding sample.

This data is accessible only to the bot operator, is capped in volume, and —
once moved to the durable store — is deleted after `CORPUS_RETENTION_DAYS` days
(default 180). It is used solely to tune this bot's filters and is not shared or
sold.

**Operators:** enabling `CORPUS_ENABLED` in production means retaining user
message content and identity beyond the 30-day window above. Disclose this to
your group members (e.g. in the `/start` text and group rules) before turning it
on, and confirm it is compatible with Telegram's Terms of Service and any local
data-protection law that applies to you. The same applies to OCR and the daily
AI summary — both send a member's content (a photo, or a day's messages) to an
external provider, and both should be disclosed to group members before being
turned on for a group.

## Removing your data

Remove the bot from a group and its per-group settings, journal and counters
stop being updated and age out on the retention windows above. For corpus data
tied to a specific user or group, contact the bot operator.
