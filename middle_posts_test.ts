import { assertEquals, assertExists } from "@std/assert";
import type {
  InlineKeyboardMarkup,
  InputMedia,
  InputRichMessage,
  Message,
  RichMessage,
} from "grammy/types.ts";
import {
  buildMiddleReplyMarkup,
  type ChannelsConfig,
  computeMessageFingerprint,
  deleteUpstreamPostFromMiddleChannels,
  extractUpstreamPostReferenceFromReply,
  findTrackedMiddleMessage,
  findTrackedPostsByReference,
  formatDeleteSummaryLines,
  formatEditSummaryLines,
  getMiddleMessageKey,
  getTrackedPostKey,
  isBetaChannelPost,
  markMiddleMessageTouched,
  type MiddleEditApi,
  parseUpstreamPostReference,
  saveTrackedPost,
  shouldMarkTouchedOnMiddleEdit,
  syncUpstreamEditToMiddleChannels,
  type TrackedPost,
} from "./middle_posts.ts";

const TEST_CHANNELS: ChannelsConfig = {
  ru: {
    "-1001003307527": { name: "@tginfo" },
    "-1001313913616": { name: "@betainfo", flags: ["beta"] },
    "-1001719500532": { name: "rualt", flags: ["alt"] },
  },
  en: {
    "-1001263222189": { name: "@tginfoen" },
    "-1001335406586": { name: "@betainfoen", flags: ["beta"] },
    "-1001253459535": { name: "enalt", flags: ["alt"] },
  },
};

function makeMessage(partial: Partial<Message>): Message {
  return {
    message_id: 1,
    date: 1_700_000_000,
    chat: { id: -1001003307527, type: "channel", title: "TGInfo" },
    ...partial,
  } as Message;
}

Deno.test("saveTrackedPost stores entries and prunes oldest beyond maxEntries", () => {
  const store: Record<string, TrackedPost> = {};
  for (let i = 1; i <= 5; i++) {
    saveTrackedPost(
      store,
      {
        upstreamChatId: -1001003307527,
        upstreamMessageId: i,
        channelName: "@tginfo",
        isBeta: false,
        createdAt: i * 1000,
        middleMessages: {},
      },
      3,
    );
  }

  assertEquals(Object.keys(store).sort(), [
    getTrackedPostKey(-1001003307527, 3),
    getTrackedPostKey(-1001003307527, 4),
    getTrackedPostKey(-1001003307527, 5),
  ]);
});

Deno.test("findTrackedMiddleMessage and markMiddleMessageTouched track touched transitions idempotently", () => {
  const store: Record<string, TrackedPost> = {};
  saveTrackedPost(store, {
    upstreamChatId: -1001003307527,
    upstreamMessageId: 42,
    channelName: "@tginfo",
    isBeta: false,
    createdAt: 1000,
    middleMessages: {
      de: {
        chatId: -1002000001,
        messageId: 77,
        kind: "text",
        touched: false,
      },
    },
  });

  const found = findTrackedMiddleMessage(store, -1002000001, 77);
  assertExists(found);
  assertEquals(found.langId, "de");
  assertEquals(found.middleMessage.touched, false);

  const first = markMiddleMessageTouched(store, -1002000001, 77);
  assertEquals(first, {
    langId: "de",
    postKey: "-1001003307527:42",
    changed: true,
  });
  assertEquals(found.middleMessage.touched, true);

  const second = markMiddleMessageTouched(store, -1002000001, 77);
  assertEquals(second, {
    langId: "de",
    postKey: "-1001003307527:42",
    changed: false,
  });

  assertEquals(markMiddleMessageTouched(store, -100999, 1), undefined);
});

Deno.test("buildMiddleReplyMarkup builds main, beta, and reply link buttons", () => {
  const mainKb = buildMiddleReplyMarkup(false, -1001003307527);
  assertEquals(mainKb.inline_keyboard.length, 3);
  assertEquals(mainKb.inline_keyboard[0][0].text, "Translate");
  assertEquals(mainKb.inline_keyboard[1][0].text, "Send to Main Channel");
  assertEquals(mainKb.inline_keyboard[2][0].text, "Idle");

  const betaReplyKb = buildMiddleReplyMarkup(true, -1001313913616, 55);
  assertEquals(betaReplyKb.inline_keyboard.length, 4);
  assertEquals(betaReplyKb.inline_keyboard[1][0].text, "Send to Beta Channel");
  assertEquals(betaReplyKb.inline_keyboard[2][0].text, "View Replied Post");
  assertEquals(
    "url" in betaReplyKb.inline_keyboard[2][0] &&
      betaReplyKb.inline_keyboard[2][0].url,
    "https://t.me/c/1313913616/55",
  );
});

Deno.test("isBetaChannelPost detects beta channels and #betainfo hashtag in alt channels", () => {
  const betaChannel = TEST_CHANNELS.ru["-1001313913616"];
  const altChannel = TEST_CHANNELS.ru["-1001719500532"];
  const mainChannel = TEST_CHANNELS.ru["-1001003307527"];

  assertEquals(isBetaChannelPost(betaChannel, makeMessage({ text: "hi" })), true);
  assertEquals(
    isBetaChannelPost(
      altChannel,
      makeMessage({
        text: "Update #betainfo",
        entities: [{ type: "hashtag", offset: 7, length: 9 }],
      }),
    ),
    true,
  );
  assertEquals(
    isBetaChannelPost(altChannel, makeMessage({ text: "Update" })),
    false,
  );
  assertEquals(
    isBetaChannelPost(
      mainChannel,
      makeMessage({
        text: "Update #betainfo",
        entities: [{ type: "hashtag", offset: 7, length: 9 }],
      }),
    ),
    false,
  );
});

Deno.test("shouldMarkTouchedOnMiddleEdit distinguishes translator edits from bot sync echoes", () => {
  const original = makeMessage({
    text: "Hello world",
    entities: [{ type: "bold", offset: 0, length: 5 }],
  });
  const middleMsg = {
    chatId: -1002000001,
    messageId: 10,
    kind: "text" as const,
    touched: false,
    lastSyncedFingerprint: computeMessageFingerprint(original),
  };

  // Same content (e.g. bot sync echo or metadata refresh): not touched
  assertEquals(shouldMarkTouchedOnMiddleEdit(middleMsg, original), false);

  // Pending in-flight bot sync edit: not touched
  const syncedText = makeMessage({ text: "Hello updated world" });
  assertEquals(
    shouldMarkTouchedOnMiddleEdit(
      middleMsg,
      syncedText,
      computeMessageFingerprint(syncedText),
    ),
    false,
  );

  // Translator edited text: touched!
  const translated = makeMessage({ text: "Hallo Welt" });
  assertEquals(shouldMarkTouchedOnMiddleEdit(middleMsg, translated), true);

  // Already touched or deleted: returns false
  assertEquals(
    shouldMarkTouchedOnMiddleEdit({ ...middleMsg, touched: true }, translated),
    false,
  );
  assertEquals(
    shouldMarkTouchedOnMiddleEdit({ ...middleMsg, deleted: true }, translated),
    false,
  );
});

Deno.test("computeMessageFingerprint canonicalizes rich message media by file_unique_id", () => {
  const rmA: RichMessage = {
    blocks: [
      { type: "paragraph", text: "Hello" },
      {
        type: "photo",
        photo: [
          { file_id: "file_id_1", file_unique_id: "uniq_1", width: 100, height: 100 },
        ],
      },
    ],
  };
  const rmB: RichMessage = {
    blocks: [
      { type: "paragraph", text: "Hello" },
      {
        type: "photo",
        photo: [
          { file_id: "different_copy_file_id", file_unique_id: "uniq_1", width: 100, height: 100 },
        ],
      },
    ],
  };
  const rmEdited: RichMessage = {
    blocks: [
      { type: "paragraph", text: "Hallo" },
      {
        type: "photo",
        photo: [
          { file_id: "different_copy_file_id", file_unique_id: "uniq_1", width: 100, height: 100 },
        ],
      },
    ],
  };

  assertEquals(
    computeMessageFingerprint(makeMessage({ rich_message: rmA })),
    computeMessageFingerprint(makeMessage({ rich_message: rmB })),
  );
  assertEquals(
    computeMessageFingerprint(makeMessage({ rich_message: rmA })) ===
      computeMessageFingerprint(makeMessage({ rich_message: rmEdited })),
    false,
  );
});

Deno.test("parseUpstreamPostReference parses public, private, and shorthand references", () => {
  assertEquals(
    parseUpstreamPostReference("https://t.me/tginfo/1234", TEST_CHANNELS),
    {
      chatId: -1001003307527,
      messageId: 1234,
      channel: { name: "@tginfo" },
    },
  );
  assertEquals(
    parseUpstreamPostReference(
      "t.me/BetaInfoEn/55?single",
      TEST_CHANNELS,
    ),
    {
      chatId: -1001335406586,
      messageId: 55,
      channel: { name: "@betainfoen", flags: ["beta"] },
    },
  );
  assertEquals(
    parseUpstreamPostReference(
      "https://t.me/c/1719500532/987",
      TEST_CHANNELS,
    ),
    {
      chatId: -1001719500532,
      messageId: 987,
      channel: { name: "rualt", flags: ["alt"] },
    },
  );
  assertEquals(
    parseUpstreamPostReference("rualt 456", TEST_CHANNELS),
    {
      chatId: -1001719500532,
      messageId: 456,
      channel: { name: "rualt", flags: ["alt"] },
    },
  );
  assertEquals(
    parseUpstreamPostReference("-1001253459535:321", TEST_CHANNELS),
    {
      chatId: -1001253459535,
      messageId: 321,
      channel: { name: "enalt", flags: ["alt"] },
    },
  );

  const unknown = parseUpstreamPostReference(
    "https://t.me/someotherchannel/10",
    TEST_CHANNELS,
  );
  assertEquals(Boolean(unknown && "error" in unknown), true);

  const invalid = parseUpstreamPostReference("not a link", TEST_CHANNELS);
  assertEquals(Boolean(invalid && "error" in invalid), true);
});

Deno.test("extractUpstreamPostReferenceFromReply handles forwards, text_links, and URL buttons", () => {
  const forwarded = makeMessage({
    forward_origin: {
      type: "channel",
      date: 1_700_000_000,
      chat: { id: -1001003307527, type: "channel", title: "TGInfo" },
      message_id: 88,
    },
  });
  assertEquals(
    extractUpstreamPostReferenceFromReply(forwarded, TEST_CHANNELS),
    {
      chatId: -1001003307527,
      messageId: 88,
      channel: { name: "@tginfo" },
    },
  );

  const notification = makeMessage({
    text: "88 was edited in @tginfo.",
    entities: [
      {
        type: "text_link",
        offset: 0,
        length: 2,
        url: "https://t.me/c/1003307527/88",
      },
    ],
  });
  assertEquals(
    extractUpstreamPostReferenceFromReply(notification, TEST_CHANNELS),
    {
      chatId: -1001003307527,
      messageId: 88,
      channel: { name: "@tginfo" },
    },
  );

  const buttonMsg = makeMessage({
    text: "The last post replies to another post.",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "View Post", url: "https://t.me/c/1719500532/77" },
          { text: "View Replied Post", url: "https://t.me/c/1719500532/76" },
        ],
      ],
    },
  });
  assertEquals(
    extractUpstreamPostReferenceFromReply(buttonMsg, TEST_CHANNELS),
    {
      chatId: -1001719500532,
      messageId: 77,
      channel: { name: "rualt", flags: ["alt"] },
    },
  );
});

Deno.test("syncUpstreamEditToMiddleChannels edits untouched text posts and skips touched/deleted ones", async () => {
  const trackedPost: TrackedPost = {
    upstreamChatId: -1001719500532,
    upstreamMessageId: 100,
    channelName: "rualt",
    isBeta: false,
    replyToMessageId: 90,
    createdAt: 1000,
    middleMessages: {
      de: { chatId: -1002001, messageId: 11, kind: "text", touched: false },
      es: { chatId: -1002002, messageId: 22, kind: "text", touched: true },
      fr: {
        chatId: -1002003,
        messageId: 33,
        kind: "text",
        touched: false,
        deleted: true,
      },
      it: { chatId: -1002004, messageId: 44, kind: "text", touched: false },
      uk: { chatId: -1002005, messageId: 55, kind: "text", touched: false },
    },
  };

  const editedTextCalls: Array<{
    chatId: number;
    messageId: number;
    text: string | InputRichMessage;
    replyMarkup?: InlineKeyboardMarkup;
  }> = [];
  const pending = new Map<string, string>();
  let sawPendingDuringCall = false;

  const api: MiddleEditApi = {
    editMessageText: (chatId, messageId, text, other) => {
      if (chatId === -1002001) {
        sawPendingDuringCall = pending.has(
          getMiddleMessageKey(chatId, messageId),
        );
      }
      if (chatId === -1002004) {
        return Promise.reject(new Error("Bad Request: message is not modified"));
      }
      if (chatId === -1002005) {
        return Promise.reject(
          new Error("Bad Request: message to edit not found"),
        );
      }
      editedTextCalls.push({
        chatId,
        messageId,
        text,
        replyMarkup: other?.reply_markup,
      });
      return Promise.resolve(
        makeMessage({
          chat: { id: chatId, type: "channel", title: "Middle" },
          message_id: messageId,
          text: typeof text === "string" ? text : undefined,
          entities: other?.entities,
        }),
      );
    },
    editMessageCaption: () => Promise.resolve(true),
    editMessageMedia: () => Promise.resolve(true),
    sendMessage: () => Promise.resolve(makeMessage({})),
    deleteMessage: () => Promise.resolve(true),
  };

  const editedPost = makeMessage({
    chat: { id: -1001719500532, type: "channel", title: "rualt" },
    message_id: 100,
    text: "Updated #betainfo",
    entities: [{ type: "hashtag", offset: 8, length: 9 }],
  });

  const result = await syncUpstreamEditToMiddleChannels({
    trackedPost,
    editedPost,
    channel: TEST_CHANNELS.ru["-1001719500532"],
    api,
    pendingSyncFingerprints: pending,
  });

  assertEquals(sawPendingDuringCall, true);
  assertEquals(pending.size, 0);
  assertEquals(trackedPost.isBeta, true);
  assertEquals(result.updated, ["de"]);
  assertEquals(result.unchanged, ["it"]);
  assertEquals(result.skippedTouched, ["es"]);
  assertEquals(result.alreadyDeleted, ["fr", "uk"]);
  assertEquals(trackedPost.middleMessages.uk.deleted, true);
  assertEquals(result.failed, []);
  assertEquals(editedTextCalls.length, 1);
  assertEquals(editedTextCalls[0].text, "Updated #betainfo");
  assertEquals(
    editedTextCalls[0].replyMarkup?.inline_keyboard[1][0].text,
    "Send to Beta Channel",
  );
  assertEquals(
    formatEditSummaryLines(result),
    [
      "Updated (1): de",
      "Unchanged (1): it",
      "Skipped (touched by translators, 1): es",
      "Already deleted (2): fr, uk",
    ],
  );
});

Deno.test("syncUpstreamEditToMiddleChannels uses editMessageCaption vs editMessageMedia properly", async () => {
  const trackedPost: TrackedPost = {
    upstreamChatId: -1001003307527,
    upstreamMessageId: 200,
    channelName: "@tginfo",
    isBeta: false,
    createdAt: 1000,
    middleMessages: {
      de: {
        chatId: -1002001,
        messageId: 11,
        kind: "media",
        touched: false,
        mediaType: "photo",
        mediaFileUniqueId: "photo_uniq_1",
      },
    },
  };

  let captionCalls = 0;
  let mediaCalls: InputMedia[] = [];

  const api: MiddleEditApi = {
    editMessageText: () => Promise.resolve(true),
    editMessageCaption: () => {
      captionCalls++;
      return Promise.resolve(true);
    },
    editMessageMedia: (_chatId, _msgId, media) => {
      mediaCalls.push(media);
      return Promise.resolve(true);
    },
    sendMessage: () => Promise.resolve(makeMessage({})),
    deleteMessage: () => Promise.resolve(true),
  };

  // Same photo unique ID -> editMessageCaption
  await syncUpstreamEditToMiddleChannels({
    trackedPost,
    editedPost: makeMessage({
      photo: [
        { file_id: "fid_1", file_unique_id: "photo_uniq_1", width: 100, height: 100 },
      ],
      caption: "New caption",
    }),
    channel: TEST_CHANNELS.ru["-1001003307527"],
    api,
  });
  assertEquals(captionCalls, 1);
  assertEquals(mediaCalls.length, 0);

  // Replaced photo unique ID -> editMessageMedia
  await syncUpstreamEditToMiddleChannels({
    trackedPost,
    editedPost: makeMessage({
      photo: [
        { file_id: "fid_2", file_unique_id: "photo_uniq_2", width: 200, height: 200 },
      ],
      caption: "Caption with new photo",
    }),
    channel: TEST_CHANNELS.ru["-1001003307527"],
    api,
  });
  assertEquals(captionCalls, 1);
  assertEquals(mediaCalls.length, 1);
  assertEquals(mediaCalls[0].type, "photo");
  assertEquals(mediaCalls[0].media, "fid_2");
  assertEquals(trackedPost.middleMessages.de.mediaFileUniqueId, "photo_uniq_2");
});

Deno.test("syncUpstreamEditToMiddleChannels handles ghost_text edits and media->ghost_text upgrades lazily", async () => {
  const trackedPost: TrackedPost = {
    upstreamChatId: -1001003307527,
    upstreamMessageId: 300,
    channelName: "@tginfo",
    isBeta: false,
    createdAt: 1000,
    middleMessages: {
      de: {
        chatId: -1002001,
        messageId: 11,
        kind: "ghost_text",
        touched: false,
        ghostImageUrl: "https://blog.example.com/old.jpg",
        mediaFileUniqueId: "img_1",
      },
      es: {
        chatId: -1002002,
        messageId: 22,
        kind: "media",
        touched: false,
        mediaType: "photo",
        mediaFileUniqueId: "img_1",
      },
      fr: {
        chatId: -1002003,
        messageId: 33,
        kind: "ghost_text",
        touched: true,
        ghostImageUrl: "https://blog.example.com/old.jpg",
        mediaFileUniqueId: "img_1",
      },
    },
  };

  let uploadCalls = 0;
  const sentMessages: Array<{ chatId: number; url?: string }> = [];
  const deletedMessages: Array<{ chatId: number; messageId: number }> = [];
  const editedUrls: Array<{ chatId: number; url?: string }> = [];

  const api: MiddleEditApi = {
    editMessageText: (chatId, _msgId, _text, other) => {
      editedUrls.push({ chatId, url: other?.link_preview_options?.url });
      return Promise.resolve(true);
    },
    editMessageCaption: () => Promise.resolve(true),
    editMessageMedia: () => Promise.resolve(true),
    sendMessage: (chatId, text, other) => {
      sentMessages.push({ chatId, url: other?.link_preview_options?.url });
      return Promise.resolve(
        makeMessage({
          chat: { id: chatId, type: "channel", title: "Middle" },
          message_id: 999,
          text,
          link_preview_options: other?.link_preview_options,
        }),
      );
    },
    deleteMessage: (chatId, messageId) => {
      deletedMessages.push({ chatId, messageId });
      return Promise.resolve(true);
    },
  };

  const longCaption = "A".repeat(1200);
  const result = await syncUpstreamEditToMiddleChannels({
    trackedPost,
    editedPost: makeMessage({
      photo: [
        { file_id: "fid_new", file_unique_id: "img_2", width: 200, height: 200 },
      ],
      caption: longCaption,
    }),
    channel: TEST_CHANNELS.ru["-1001003307527"],
    api,
    uploadGhostImage: () => {
      uploadCalls++;
      return Promise.resolve({
        url: "https://blog.example.com/new.jpg",
        fileUniqueId: "img_2",
      });
    },
  });

  // Uploaded once and shared across both untouched channels
  assertEquals(uploadCalls, 1);
  assertEquals(result.updated, ["de", "es"]);
  assertEquals(result.skippedTouched, ["fr"]);
  assertEquals(editedUrls, [
    { chatId: -1002001, url: "https://blog.example.com/new.jpg" },
  ]);
  assertEquals(sentMessages, [
    { chatId: -1002002, url: "https://blog.example.com/new.jpg" },
  ]);
  assertEquals(deletedMessages, [{ chatId: -1002002, messageId: 22 }]);
  assertEquals(trackedPost.middleMessages.es.kind, "ghost_text");
  assertEquals(trackedPost.middleMessages.es.messageId, 999);
});

Deno.test("deleteUpstreamPostFromMiddleChannels deletes only untouched posts and classifies errors", async () => {
  const trackedPost: TrackedPost = {
    upstreamChatId: -1001003307527,
    upstreamMessageId: 500,
    channelName: "@tginfo",
    isBeta: false,
    createdAt: 1000,
    middleMessages: {
      de: { chatId: -1002001, messageId: 11, kind: "text", touched: false },
      es: { chatId: -1002002, messageId: 22, kind: "text", touched: true },
      fr: {
        chatId: -1002003,
        messageId: 33,
        kind: "text",
        touched: false,
        deleted: true,
      },
      it: { chatId: -1002004, messageId: 44, kind: "text", touched: false },
      uk: { chatId: -1002005, messageId: 55, kind: "text", touched: false },
    },
  };

  const deletedIds: number[] = [];
  const result = await deleteUpstreamPostFromMiddleChannels({
    trackedPost,
    api: {
      deleteMessage: (chatId, messageId) => {
        if (chatId === -1002004) {
          return Promise.reject(
            new Error("Bad Request: message to delete not found"),
          );
        }
        if (chatId === -1002005) {
          return Promise.reject(
            new Error("Bad Request: message can't be deleted"),
          );
        }
        deletedIds.push(messageId);
        return Promise.resolve(true);
      },
    },
  });

  assertEquals(deletedIds, [11]);
  assertEquals(result.deleted, ["de"]);
  assertEquals(result.skippedTouched, ["es"]);
  assertEquals(result.alreadyDeleted, ["fr", "it"]);
  assertEquals(result.failed, [
    { langId: "uk", error: "Bad Request: message can't be deleted" },
  ]);
  assertEquals(trackedPost.middleMessages.de.deleted, true);
  assertEquals(trackedPost.middleMessages.es.deleted, undefined);
  assertEquals(trackedPost.middleMessages.it.deleted, true);
  assertEquals(trackedPost.middleMessages.uk.deleted, undefined);

  assertEquals(
    formatDeleteSummaryLines(result),
    [
      "Deleted (1): de",
      "Skipped (touched by translators, 1): es",
      "Already deleted (2): fr, it",
      "Failed (1): uk",
    ],
  );
});

Deno.test("rualt/enalt deep links, aliases, #BetaInfo casing, link_preview_options, and forwardOrigin lookup", async () => {
  // Deep links and alt channel aliases
  assertEquals(
    parseUpstreamPostReference(
      "tg://privatepost?channel=1719500532&post=456",
      TEST_CHANNELS,
    ),
    {
      chatId: -1001719500532,
      messageId: 456,
      channel: { name: "rualt", flags: ["alt"] },
    },
  );
  assertEquals(
    parseUpstreamPostReference(
      "tg://privatepost?post=789&channel=1253459535",
      TEST_CHANNELS,
    ),
    {
      chatId: -1001253459535,
      messageId: 789,
      channel: { name: "enalt", flags: ["alt"] },
    },
  );
  assertEquals(
    parseUpstreamPostReference(
      "tg://resolve?domain=tginfoen&post=321",
      TEST_CHANNELS,
    ),
    {
      chatId: -1001263222189,
      messageId: 321,
      channel: { name: "@tginfoen" },
    },
  );
  assertEquals(
    parseUpstreamPostReference("ru_alt 456", TEST_CHANNELS),
    {
      chatId: -1001719500532,
      messageId: 456,
      channel: { name: "rualt", flags: ["alt"] },
    },
  );
  assertEquals(
    parseUpstreamPostReference("en-alt:789", TEST_CHANNELS),
    {
      chatId: -1001253459535,
      messageId: 789,
      channel: { name: "enalt", flags: ["alt"] },
    },
  );

  // Case-insensitive #BetaInfo in alt channel
  assertEquals(
    isBetaChannelPost(
      TEST_CHANNELS.en["-1001253459535"],
      makeMessage({
        chat: { id: -1001253459535, type: "channel", title: "enalt" },
        text: "Release notes #BetaInfo",
        entities: [{ type: "hashtag", offset: 14, length: 9 }],
      }),
    ),
    true,
  );

  // Link preview options changes are reflected in fingerprint for alt posts
  const previewAbove = makeMessage({
    text: "Alt post with photo link",
    link_preview_options: {
      url: "https://telegra.ph/file/example.jpg",
      show_above_text: true,
      prefer_large_media: true,
    },
  });
  const previewBelow = makeMessage({
    text: "Alt post with photo link",
    link_preview_options: {
      url: "https://telegra.ph/file/example.jpg",
      show_above_text: false,
      prefer_large_media: true,
    },
  });
  assertEquals(
    computeMessageFingerprint(previewAbove) ===
      computeMessageFingerprint(previewBelow),
    false,
  );

  // forwardOrigin lookup links forwarded rualt/enalt posts to their upstream source
  const store: Record<string, TrackedPost> = {};
  saveTrackedPost(store, {
    upstreamChatId: -1001719500532,
    upstreamMessageId: 50,
    channelName: "rualt",
    isBeta: false,
    forwardOrigin: { chatId: -1001003307527, messageId: 100 },
    createdAt: 1000,
    middleMessages: {
      de: { chatId: -1002001, messageId: 11, kind: "text", touched: false },
    },
  });

  // Direct lookup by rualt ID works
  assertEquals(findTrackedPostsByReference(store, -1001719500532, 50).length, 1);
  // Lookup by original @tginfo ID also finds the forwarded rualt post
  assertEquals(findTrackedPostsByReference(store, -1001003307527, 100).length, 1);

  // Clearing a caption passes empty string "" to editMessageCaption
  let receivedCaption: string | undefined = "not-called";
  const trackedMedia: TrackedPost = {
    upstreamChatId: -1001253459535,
    upstreamMessageId: 60,
    channelName: "enalt",
    isBeta: false,
    createdAt: 1000,
    middleMessages: {
      es: {
        chatId: -1002002,
        messageId: 22,
        kind: "media",
        touched: false,
        mediaType: "photo",
        mediaFileUniqueId: "uniq_alt",
      },
    },
  };
  await syncUpstreamEditToMiddleChannels({
    trackedPost: trackedMedia,
    editedPost: makeMessage({
      chat: { id: -1001253459535, type: "channel", title: "enalt" },
      message_id: 60,
      photo: [
        { file_id: "fid_alt", file_unique_id: "uniq_alt", width: 100, height: 100 },
      ],
    }),
    channel: TEST_CHANNELS.en["-1001253459535"],
    api: {
      editMessageText: () => Promise.resolve(true),
      editMessageCaption: (_c, _m, other) => {
        receivedCaption = other?.caption;
        return Promise.resolve(true);
      },
      editMessageMedia: () => Promise.resolve(true),
      sendMessage: () => Promise.resolve(makeMessage({})),
      deleteMessage: () => Promise.resolve(true),
    },
  });
  assertEquals(receivedCaption, "");
});
