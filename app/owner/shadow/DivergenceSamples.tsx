"use client";

import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/contexts/AppProvider";
import { Card, CardSection } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { Collapsible } from "@/components/Collapsible";
import { haptic, hapticNotify, openTelegramLink } from "@/lib/miniapp/telegram";
import type { GoldLabel } from "@/lib/db/corpus";
import type { DivergenceSample } from "@/lib/db/shadowStats";

type LabelResult = "stored" | "duplicate" | "skipped" | "no_text";

/** A stored divergence sample plus the message text joined in from the
 * messageAuthors cache (null when it's not cached — the sample buffer outlives
 * that cache, and a Redis blip can also drop the write). */
interface Sample extends DivergenceSample {
  text: string | null;
}

/** Index row: one per group that has any divergence sample. Samples load
 * lazily when the row is opened. */
interface IndexGroup {
  chatId: number;
  title: string;
  count: number;
}

interface IndexResponse {
  corpusEnabled: boolean;
  groups: IndexGroup[];
}

interface PageResponse {
  samples: Sample[];
  offset: number;
  pageSize: number;
}

interface GroupState {
  samples: Sample[];
  loading: boolean;
  failed: boolean;
}

const LABELS: GoldLabel[] = ["spam", "scam", "profanity", "none"];

/** t.me deep link for a supergroup message, so the owner (rarely a member of
 * the group) can still open the real message to judge it. Only -100… ids have
 * a link format; basic groups return null. */
function messageLink(chatId: number, messageId: number): string | null {
  const s = String(chatId);
  return s.startsWith("-100") ? `https://t.me/c/${s.slice(4)}/${messageId}` : null;
}

export function DivergenceSamples() {
  const { t, fetcher } = useApp();
  const [index, setIndex] = useState<IndexResponse | null>(null);
  const [error, setError] = useState(false);
  const [groups, setGroups] = useState<Record<number, GroupState>>({});
  const [labeled, setLabeled] = useState<Record<string, { label: GoldLabel; result: LabelResult }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetcher<IndexResponse>("/api/miniapp/owner/shadow/samples")
      .then((d) => !cancelled && setIndex(d))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [fetcher]);

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast((cur) => (cur === message ? null : cur)), 2200);
  }

  const loadPage = useCallback(
    async (chatId: number, offset: number) => {
      setGroups((cur) => {
        if (cur[chatId]?.loading) return cur;
        return { ...cur, [chatId]: { samples: cur[chatId]?.samples ?? [], loading: true, failed: false } };
      });
      try {
        const page = await fetcher<PageResponse>(
          `/api/miniapp/owner/shadow/samples?group=${chatId}&offset=${offset}`
        );
        setGroups((cur) => {
          const prev = cur[chatId]?.samples ?? [];
          // The buffer is lpush/ltrim, so it can shift between the index read
          // and this page — dedupe by messageId rather than trust the offset.
          const seen = new Set(prev.map((s) => s.messageId));
          const merged = [...prev, ...page.samples.filter((s) => !seen.has(s.messageId))];
          return { ...cur, [chatId]: { samples: merged, loading: false, failed: false } };
        });
      } catch {
        setGroups((cur) => ({
          ...cur,
          [chatId]: { samples: cur[chatId]?.samples ?? [], loading: false, failed: true },
        }));
      }
    },
    [fetcher]
  );

  async function label(chatId: number, messageId: number, value: GoldLabel) {
    const key = `${chatId}:${messageId}`;
    if (busy || labeled[key]) return;
    haptic("light");
    setBusy(key);
    try {
      const { result } = await fetcher<{ result: LabelResult }>("/api/miniapp/owner/shadow/label", {
        method: "POST",
        body: JSON.stringify({ chatId, messageId, label: value }),
      });
      if (result === "no_text" || result === "skipped") {
        // skipped = CORPUS_ENABLED off: nothing was stored, so leave the
        // buttons active rather than showing a misleading ✓.
        hapticNotify(result === "skipped" ? "warning" : "error");
        flash(result === "skipped" ? t("miniapp.shadowLabelCorpusOff") : t("miniapp.shadowLabelNoText"));
        return;
      }
      setLabeled((cur) => ({ ...cur, [key]: { label: value, result } }));
      hapticNotify("success");
      flash(
        result === "duplicate"
          ? t("miniapp.shadowLabelDuplicate")
          : t("miniapp.shadowLabelSaved", { label: t(`miniapp.shadowLabel_${value}`) })
      );
    } catch {
      hapticNotify("error");
      flash(t("miniapp.shadowLabelError"));
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return (
      <Card>
        <CardSection>
          <p className="text-[13px]" style={{ color: "var(--ink-muted)" }}>
            {t("miniapp.connectionError")}
          </p>
        </CardSection>
      </Card>
    );
  }
  if (!index) return null;

  return (
    <Card>
      {toast && (
        <div
          className="fixed top-3 left-1/2 -translate-x-1/2 z-20 rounded-full px-3.5 py-1.5 text-[12px] font-medium text-center max-w-[90vw]"
          style={{ background: "var(--ink)", color: "#fff" }}
        >
          {toast}
        </div>
      )}
      <CardSection title={t("miniapp.shadowSamplesTitle")} subtitle={t("miniapp.shadowSamplesHint")}>
        {!index.corpusEnabled && (
          <p
            className="text-[12px] mb-3 rounded-[var(--radius-sm)] p-2.5"
            style={{ background: "var(--status-warning-wash)", color: "#8a5c00" }}
          >
            {t("miniapp.shadowSamplesCorpusOff")}
          </p>
        )}
        {index.groups.length === 0 ? (
          <p className="text-[13px]" style={{ color: "var(--ink-muted)" }}>
            {t("miniapp.shadowSamplesEmpty")}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {index.groups.map((group) => {
              const state = groups[group.chatId];
              const loaded = state?.samples.length ?? 0;
              return (
                <Collapsible
                  key={group.chatId}
                  title={`${group.title} · ${group.count}`}
                  onOpen={() => {
                    if (!groups[group.chatId]) loadPage(group.chatId, 0);
                  }}
                >
                  <div className="flex flex-col gap-3">
                    {state?.samples.map((s) => (
                      <SampleRow
                        key={s.messageId}
                        chatId={group.chatId}
                        sample={s}
                        done={labeled[`${group.chatId}:${s.messageId}`]}
                        busy={busy !== null}
                        onLabel={(value) => label(group.chatId, s.messageId, value)}
                        t={t}
                      />
                    ))}

                    {state?.loading && (
                      <p className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
                        {t("common.loading")}
                      </p>
                    )}

                    {state && !state.loading && state.failed && loaded === 0 && (
                      <p className="text-[12px]" style={{ color: "var(--ink-muted)" }}>
                        {t("miniapp.connectionError")}
                      </p>
                    )}

                    {state && !state.loading && (loaded < group.count || state.failed) && (
                      <button
                        type="button"
                        onClick={() => loadPage(group.chatId, loaded)}
                        className="self-start rounded-full px-3 py-1 text-[12px] font-medium"
                        style={{ background: "#f2f1ee", color: "var(--ink-secondary)" }}
                      >
                        {state.failed ? t("common.error") : t("miniapp.shadowSamplesMore")}
                      </button>
                    )}
                  </div>
                </Collapsible>
              );
            })}
          </div>
        )}
      </CardSection>
    </Card>
  );
}

function SampleRow({
  chatId,
  sample: s,
  done,
  busy,
  onLabel,
  t,
}: {
  chatId: number;
  sample: Sample;
  done?: { label: GoldLabel; result: LabelResult };
  busy: boolean;
  onLabel: (value: GoldLabel) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const link = messageLink(chatId, s.messageId);
  return (
    <div className="rounded-[var(--radius-sm)] border p-2.5" style={{ borderColor: "var(--border)" }}>
      <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
        <Badge variant={s.divergence === "stricter" ? "warning" : "accent"}>
          {t(s.divergence === "stricter" ? "miniapp.shadowStricter" : "miniapp.shadowLooser")}
        </Badge>
        <span className="text-[11px]" style={{ color: "var(--ink-muted)" }}>
          score {s.score} · {s.zone}
          {s.oldCategory
            ? ` · ${t("miniapp.shadowSampleOld", { category: t(`miniapp.shadowOldCat_${s.oldCategory}`) })}`
            : ""}
        </span>
      </div>

      {s.text ? (
        <p className="text-[13px] break-words whitespace-pre-wrap" style={{ color: "var(--ink)" }}>
          {s.text}
        </p>
      ) : (
        <p className="text-[12px] italic" style={{ color: "var(--ink-muted)" }}>
          {t("miniapp.shadowSampleTextUnavailable")}
        </p>
      )}

      {s.signals.length > 0 && (
        <p className="text-[11px] mt-1" style={{ color: "var(--ink-muted)" }}>
          {s.signals.map((sig) => `${sig.name}:${sig.weight}`).join(" · ")}
        </p>
      )}

      {link && (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => {
            e.preventDefault();
            openTelegramLink(link);
          }}
          className="text-[12px] mt-1 inline-block"
          style={{ color: "var(--accent-strong)" }}
        >
          {t("miniapp.shadowSampleOpenInTelegram")}
        </a>
      )}

      <div className="flex flex-wrap gap-1.5 mt-2">
        {done ? (
          <Badge variant="good">✓ {t(`miniapp.shadowLabel_${done.label}`)}</Badge>
        ) : (
          LABELS.map((value) => (
            <button
              key={value}
              type="button"
              disabled={!s.text || busy}
              onClick={() => onLabel(value)}
              className="rounded-full px-2.5 py-1 text-[12px] font-medium disabled:opacity-40"
              style={{
                background: value === s.oldCategory ? "var(--accent-wash)" : "#f2f1ee",
                color: value === s.oldCategory ? "var(--accent-strong)" : "var(--ink-secondary)",
              }}
            >
              {t(`miniapp.shadowLabel_${value}`)}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
