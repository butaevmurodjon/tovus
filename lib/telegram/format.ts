import type { User } from "grammy/types";

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function mentionHtml(user: User): string {
  const name = escapeHtml(displayName(user));
  return `<a href="tg://user?id=${user.id}">${name}</a>`;
}

export function displayName(user: User): string {
  if (user.username) return `@${user.username}`;
  return [user.first_name, user.last_name].filter(Boolean).join(" ") || `id${user.id}`;
}
