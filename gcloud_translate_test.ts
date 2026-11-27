import { assertEquals, assertRejects } from "@std/assert";
import type { MessageEntity, RichMessage } from "grammy/types.ts";
import { translateTextAndEntitiesHtml } from "./entities_html.ts";
import {
  chunkContents,
  CloudTranslationError,
  createQuotaTranslateSession,
  type QuotaUserInfo,
  resetQuota,
} from "./gcloud_translate_helpers.ts";
import { translateRichMessageHtml } from "./rich_message.ts";

function makeUser(userId: number, quota = 1): QuotaUserInfo {
  return {
    userId,
    userSettings: {
      cloudTranslateQuota: quota,
      cloudTranslateQuotaDuration: 60_000,
    },
  };
}

Deno.test("createQuotaTranslateSession charges quota once across multiple batches for oversized rich messages", async () => {
  const user = makeUser(900_001, 1);
  resetQuota(user.userId);

  const rm: RichMessage = {
    blocks: [
      { type: "paragraph", text: "Intro block" },
      { type: "paragraph", text: "word ".repeat(80).trim() },
      { type: "paragraph", text: "Outro block" },
    ],
  };

  let executorCalls = 0;
  const session = createQuotaTranslateSession(user, (payload) => {
    executorCalls++;
    return Promise.resolve({
      ...payload,
      success: true,
      contents: payload.contents.map((c) => c.replace(/word/g, "слово")),
    });
  });

  const translated = await translateRichMessageHtml(
    rm,
    async (docs) => {
      const res = await session.translateBatch({
        contents: docs,
        targetLanguage: "ru",
        mimeType: "text/html",
      });
      return res.contents;
    },
    150,
  );

  // Even though multiple batch calls occurred inside one rich message translation,
  // quota (limit=1) was only charged once.
  assertEquals(executorCalls >= 2, true);
  assertEquals(translated.blocks?.length, 3);

  // A subsequent separate session for the same user now hits the quota limit.
  const secondSession = createQuotaTranslateSession(user, (payload) =>
    Promise.resolve({ ...payload, success: true }));
  await assertRejects(
    () =>
      secondSession.translateBatch({
        contents: ["<p>Next</p>"],
        targetLanguage: "ru",
      }),
    CloudTranslationError,
    "over quota",
  );

  resetQuota(user.userId);
});

Deno.test("createQuotaTranslateSession skips quota on empty calls and refunds on initial failure", async () => {
  const user = makeUser(900_002, 1);
  resetQuota(user.userId);

  // Empty batch should not reserve quota.
  const emptySession = createQuotaTranslateSession(user, (payload) =>
    Promise.resolve({ ...payload, success: true }));
  const emptyRes = await emptySession.translateBatch({
    contents: [],
    targetLanguage: "ru",
  });
  assertEquals(emptyRes.contents, []);

  // Failed initial batch should refund quota so a retry succeeds.
  const failingSession = createQuotaTranslateSession(user, () =>
    Promise.reject(new Error("transient network error")));
  await assertRejects(
    () =>
      failingSession.translateBatch({
        contents: ["<p>Hello</p>"],
        targetLanguage: "ru",
      }),
    Error,
    "transient network error",
  );

  // Retry succeeds because quota was refunded.
  const retrySession = createQuotaTranslateSession(user, (payload) =>
    Promise.resolve({ ...payload, success: true, contents: [""] }));
  const retryRes = await retrySession.translateBatch({
    contents: ["<p>Hello</p>"],
    targetLanguage: "ru",
  });
  assertEquals(retryRes.contents, [""]);

  resetQuota(user.userId);
});

Deno.test("createQuotaTranslateSession does not refund quota after a partial success", async () => {
  const user = makeUser(900_003, 1);
  resetQuota(user.userId);

  let call = 0;
  const session = createQuotaTranslateSession(user, (payload) => {
    call++;
    if (call === 1) {
      return Promise.resolve({ ...payload, success: true });
    }
    return Promise.reject(new Error("second batch failed"));
  });

  await session.translateBatch({
    contents: ["<p>First</p>"],
    targetLanguage: "ru",
  });
  await assertRejects(
    () =>
      session.translateBatch({
        contents: ["<p>Second</p>"],
        targetLanguage: "ru",
      }),
    Error,
    "second batch failed",
  );

  const nextSession = createQuotaTranslateSession(user, (payload) =>
    Promise.resolve({ ...payload, success: true }));
  await assertRejects(
    () =>
      nextSession.translateBatch({
        contents: ["<p>Third</p>"],
        targetLanguage: "ru",
      }),
    CloudTranslationError,
    "over quota",
  );

  resetQuota(user.userId);
});

Deno.test("chunkContents enforces maxBatchChars and maxBatchItems", () => {
  const batches = chunkContents(["aaaa", "bbbb", "cccc", "dd"], 8, 2);
  assertEquals(batches, [["aaaa", "bbbb"], ["cccc", "dd"]]);

  const byCount = chunkContents(["a", "b", "c", "d", "e"], 100, 2);
  assertEquals(byCount, [["a", "b"], ["c", "d"], ["e"]]);
});

Deno.test("createQuotaTranslateSession charges quota once when oversized entity HTML splits into chunks", async () => {
  const user = makeUser(900_004, 1);
  resetQuota(user.userId);

  const text = "👍 a 👍 b 👍 c 👍 d";
  const entities: MessageEntity[] = [
    { type: "custom_emoji", custom_emoji_id: "1", offset: 0, length: 2 },
    { type: "custom_emoji", custom_emoji_id: "2", offset: 5, length: 2 },
    { type: "custom_emoji", custom_emoji_id: "3", offset: 10, length: 2 },
    { type: "custom_emoji", custom_emoji_id: "4", offset: 15, length: 2 },
  ];

  let executorCalls = 0;
  const session = createQuotaTranslateSession(user, (payload) => {
    executorCalls++;
    return Promise.resolve({
      ...payload,
      success: true,
      contents: payload.contents,
    });
  });

  const translated = await translateTextAndEntitiesHtml(
    text,
    entities,
    async (html) => {
      const res = await session.translateBatch({
        contents: [html],
        targetLanguage: "ru",
        mimeType: "text/html",
      });
      return res.contents[0];
    },
    220,
  );

  assertEquals(executorCalls >= 2, true);
  assertEquals(translated.text, text);
  assertEquals(translated.entities.length, 4);

  const secondSession = createQuotaTranslateSession(user, (payload) =>
    Promise.resolve({ ...payload, success: true }));
  await assertRejects(
    () =>
      secondSession.translateBatch({
        contents: ["next"],
        targetLanguage: "ru",
      }),
    CloudTranslationError,
    "over quota",
  );

  resetQuota(user.userId);
});

Deno.test("createQuotaTranslateSession does not refund quota when a later chunk inside one translateBatch fails", async () => {
  const user = makeUser(900_005, 1);
  resetQuota(user.userId);

  let batchCalls = 0;
  const session = createQuotaTranslateSession(
    user,
    (payload) => {
      batchCalls++;
      if (batchCalls === 1) {
        return Promise.resolve({ ...payload, success: true });
      }
      return Promise.reject(new Error("second sub-batch failed"));
    },
    { maxBatchChars: 10, maxBatchItems: 1 },
  );

  await assertRejects(
    () =>
      session.translateBatch({
        contents: ["first", "second"],
        targetLanguage: "ru",
      }),
    Error,
    "second sub-batch failed",
  );
  assertEquals(batchCalls, 2);

  // Quota must remain consumed because the first sub-batch succeeded.
  const nextSession = createQuotaTranslateSession(user, (payload) =>
    Promise.resolve({ ...payload, success: true }));
  await assertRejects(
    () =>
      nextSession.translateBatch({
        contents: ["third"],
        targetLanguage: "ru",
      }),
    CloudTranslationError,
    "over quota",
  );

  resetQuota(user.userId);
});
