import type { Message } from "grammy/types";
import { ANTI_FIRST_COMMENT_WINDOW_SECONDS } from "./spamDict";

/**
 * ROADMAP.md §7.3 "Антипервонах" — a comment on a channel post, posted
 * suspiciously fast after the post itself landed in the linked discussion
 * group. Spam bots monitor channel publications and race to be the
 * first/most-visible comment.
 *
 * `reply_to_message` is the FULL replied-to message (Bot API includes it
 * inline on the update), so this needs no extra storage or API call —
 * `is_automatic_forward` is only ever true for the channel's own post
 * auto-forwarded into its linked discussion group, never for an ordinary
 * member's reply, so this can't misfire on an unrelated fast reply chain.
 */
export function isTooFastFirstComment(message: Message, windowSeconds = ANTI_FIRST_COMMENT_WINDOW_SECONDS): boolean {
  const replyTo = message.reply_to_message;
  if (!replyTo?.is_automatic_forward) return false;
  const secondsSincePost = message.date - replyTo.date;
  return secondsSincePost >= 0 && secondsSincePost < windowSeconds;
}
