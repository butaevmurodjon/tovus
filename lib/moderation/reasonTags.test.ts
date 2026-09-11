import { describe, expect, it } from "vitest";
import { classifyReasonTag } from "./reasonTags";

describe("classifyReasonTag", () => {
  const cases: {
    name: string;
    source: string | null | undefined;
    reason: string;
    expected: ReturnType<typeof classifyReasonTag>;
  }[] = [
    { name: "profanity source", source: "profanity", reason: "нецензурная лексика", expected: "profanity" },
    { name: "premium-ai source", source: "premium-ai", reason: "спам/реклама (ИИ)", expected: "ai" },
    { name: "flood source", source: "flood", reason: "флуд: слишком много сообщений подряд", expected: "flood" },
    {
      name: "spam-detector: dangerous file tag",
      source: "spam-detector",
      reason: "опасный тип файла: apk",
      expected: "apk",
    },
    {
      name: "spam-detector: dangerous file tag from quoted message",
      source: "spam-detector",
      reason: "опасный тип файла в цитируемом сообщении: apk",
      expected: "apk",
    },
    {
      name: "spam-detector: scam scheme",
      source: "spam-detector",
      reason: "скам-схема: заработок без вложений",
      expected: "scam",
    },
    {
      name: "spam-detector: scam scheme in quote",
      source: "spam-detector",
      reason: "скам-схема в цитате: лёгкий доход",
      expected: "scam",
    },
    {
      name: "spam-detector: blacklisted domain",
      source: "spam-detector",
      reason: "запрещённый домен: spam.example",
      expected: "phishing_link",
    },
    {
      name: "spam-detector: masked link",
      source: "spam-detector",
      reason: "маскированная ссылка (ведёт на evil.example)",
      expected: "phishing_link",
    },
    {
      name: "spam-detector: invite link",
      source: "spam-detector",
      reason: "ссылка-приглашение в чужой канал/чат",
      expected: "phishing_link",
    },
    {
      name: "spam-detector: cloaked bot link",
      source: "spam-detector",
      reason: "обычное слово замаскировано под ссылку на бота: старт",
      expected: "phishing_link",
    },
    {
      name: "spam-detector: ad phrase (реклама marker)",
      source: "spam-detector",
      reason: "реклама, замаскированная под цитату: подпишись",
      expected: "ads",
    },
    {
      name: "spam-detector: CTA in quote (nominative призыв)",
      source: "spam-detector",
      reason: "цитата содержит призыв к действию",
      expected: "ads",
    },
    {
      name: "spam-detector: forward/link + CTA (instrumental призывом)",
      source: "spam-detector",
      reason: "пересылка/ссылка с призывом к действию",
      expected: "ads",
    },
    {
      name: "spam-detector: mention + CTA (instrumental призывом)",
      source: "spam-detector",
      reason: "упоминание с призывом к действию",
      expected: "ads",
    },
    {
      name: "spam-detector: raw link count",
      source: "spam-detector",
      reason: "5 ссылок в сообщении",
      expected: "ads",
    },
    {
      name: "spam-detector: mass mentions",
      source: "spam-detector",
      reason: "массовые упоминания (10)",
      expected: "ads",
    },
    {
      name: "spam-detector: unrecognized reason falls back to other",
      source: "spam-detector",
      reason: "какой-то новый паттерн без маркера",
      expected: "other",
    },
    {
      name: "restricted-content source falls back to other",
      source: "restricted-content",
      reason: "пересланное сообщение в период ограничения",
      expected: "other",
    },
    {
      name: "night-mode source falls back to other",
      source: "night-mode",
      reason: "тихий час: сообщения от участников ограничены",
      expected: "other",
    },
    {
      name: "unrecognized/missing source falls back to other",
      source: undefined,
      reason: "спам",
      expected: "other",
    },
  ];

  for (const { name, source, reason, expected } of cases) {
    it(name, () => {
      expect(classifyReasonTag(source, reason, "spam")).toBe(expected);
    });
  }
});
