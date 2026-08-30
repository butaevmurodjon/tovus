# Privacy

## What the bot stores during normal operation

| Data | Where | Retention |
|---|---|---|
| Group settings, admin list, member counts | Redis | until the bot is removed from the group |
| Deleted-message journal (text, sender name/id, reason) | Redis | last 300 entries per group |
| Recent message text + sender id/username (for "who posted this" / ban cleanup) | Redis | 30 days |
| Aggregate counters (message counts, violation counts, hourly activity) | Redis | 90 days |
| User reputation score (per group) | Redis | 30 days of inactivity |

No message content is sent to third parties except: messages a **premium**-mode
group explicitly opts into having classified by the DeepSeek API (only borderline
cases are sent; DeepSeek's data-retention terms apply).

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
data-protection law that applies to you.

## Removing your data

Remove the bot from a group and its per-group settings, journal and counters
stop being updated and age out on the retention windows above. For corpus data
tied to a specific user or group, contact the bot operator.
