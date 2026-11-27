import type {
  InlineKeyboardButton,
  InlineKeyboardMarkup,
  InputMedia,
  InputMediaAnimation,
  InputMediaAudio,
  InputMediaDocument,
  InputMediaPhoto,
  InputMediaVideo,
  InputRichMessage,
  LinkPreviewOptions,
  Message,
  MessageEntity,
  RichBlock,
  RichBlockCaption,
  RichMessage,
  RichText,
} from "grammy/types.ts";
import { extractRichMessageHashtags, toInputRichMessage } from "./rich_message.ts";
import { linkMessage } from "./utils_helpers.ts";

export const MAX_CAPTION_LENGTH = 1024;
export const MAX_TRACKED_POSTS = 500;

export type MiddleMessageKind =
  | "text"
  | "media"
  | "rich_message"
  | "ghost_text";

export type EditableMediaType =
  | "photo"
  | "video"
  | "animation"
  | "audio"
  | "document";

export interface TrackedMiddleMessage {
  chatId: number;
  messageId: number;
  kind: MiddleMessageKind;
  touched: boolean;
  deleted?: boolean;
  mediaFileUniqueId?: string;
  mediaType?: EditableMediaType;
  ghostImageUrl?: string;
  lastSyncedFingerprint?: string;
}

export interface TrackedPost {
  upstreamChatId: number;
  upstreamMessageId: number;
  channelName: string;
  isBeta: boolean;
  replyToMessageId?: number;
  forwardOrigin?: {
    chatId: number;
    messageId: number;
  };
  createdAt: number;
  middleMessages: Record<string, TrackedMiddleMessage>;
}

export interface UpstreamChannelInfo {
  name: string;
  flags?: string[];
}

export type ChannelsConfig = Record<
  string,
  Record<string, UpstreamChannelInfo>
>;

export interface ExtractedMedia {
  type: EditableMediaType;
  fileId: string;
  fileUniqueId: string;
}

export interface EditSyncResult {
  updated: string[];
  unchanged: string[];
  skippedTouched: string[];
  alreadyDeleted: string[];
  failed: Array<{ langId: string; error: string }>;
  longCaptionUnhandled: boolean;
  mutated: boolean;
}

export interface DeleteSyncResult {
  deleted: string[];
  skippedTouched: string[];
  alreadyDeleted: string[];
  failed: Array<{ langId: string; error: string }>;
  mutated: boolean;
}

export interface MiddleEditApi {
  editMessageText: (
    chatId: number,
    messageId: number,
    text: string | InputRichMessage,
    other?: {
      entities?: MessageEntity[];
      link_preview_options?: LinkPreviewOptions;
      reply_markup?: InlineKeyboardMarkup;
    },
  ) => Promise<Message | true>;
  editMessageCaption: (
    chatId: number,
    messageId: number,
    other?: {
      caption?: string;
      caption_entities?: MessageEntity[];
      show_caption_above_media?: boolean;
      reply_markup?: InlineKeyboardMarkup;
    },
  ) => Promise<Message | true>;
  editMessageMedia: (
    chatId: number,
    messageId: number,
    media: InputMedia,
    other?: {
      reply_markup?: InlineKeyboardMarkup;
    },
  ) => Promise<Message | true>;
  sendMessage: (
    chatId: number,
    text: string,
    other?: {
      entities?: MessageEntity[];
      link_preview_options?: LinkPreviewOptions;
      reply_markup?: InlineKeyboardMarkup;
    },
  ) => Promise<Message>;
  deleteMessage: (chatId: number, messageId: number) => Promise<unknown>;
}

export interface MiddleDeleteApi {
  deleteMessage: (chatId: number, messageId: number) => Promise<unknown>;
}

export function getTrackedPostKey(chatId: number, messageId: number): string {
  return `${chatId}:${messageId}`;
}

export function getMiddleMessageKey(chatId: number, messageId: number): string {
  return `${chatId}:${messageId}`;
}

export function saveTrackedPost(
  store: Record<string, TrackedPost>,
  post: TrackedPost,
  maxEntries = MAX_TRACKED_POSTS,
): void {
  const key = getTrackedPostKey(post.upstreamChatId, post.upstreamMessageId);
  store[key] = post;

  const keys = Object.keys(store);
  if (keys.length <= maxEntries) {
    return;
  }

  keys.sort((a, b) => (store[a]?.createdAt ?? 0) - (store[b]?.createdAt ?? 0));
  const excess = keys.length - maxEntries;
  for (let i = 0; i < excess; i++) {
    delete store[keys[i]];
  }
}

export function findTrackedPostsByReference(
  store: Record<string, TrackedPost>,
  chatId: number,
  messageId: number,
): TrackedPost[] {
  const matched: TrackedPost[] = [];
  const seenKeys = new Set<string>();

  const directKey = getTrackedPostKey(chatId, messageId);
  const direct = store[directKey];
  if (direct) {
    matched.push(direct);
    seenKeys.add(directKey);
  }

  for (const [key, post] of Object.entries(store)) {
    if (seenKeys.has(key)) continue;
    if (
      post.forwardOrigin &&
      post.forwardOrigin.chatId === chatId &&
      post.forwardOrigin.messageId === messageId
    ) {
      matched.push(post);
      seenKeys.add(key);
    }
  }

  return matched;
}

export function findTrackedMiddleMessage(
  store: Record<string, TrackedPost>,
  middleChatId: number,
  middleMessageId: number,
): {
  postKey: string;
  post: TrackedPost;
  langId: string;
  middleMessage: TrackedMiddleMessage;
} | undefined {
  for (const [postKey, post] of Object.entries(store)) {
    for (const [langId, middleMessage] of Object.entries(post.middleMessages)) {
      if (
        middleMessage.chatId === middleChatId &&
        middleMessage.messageId === middleMessageId
      ) {
        return { postKey, post, langId, middleMessage };
      }
    }
  }
  return undefined;
}

export function markMiddleMessageTouched(
  store: Record<string, TrackedPost>,
  middleChatId: number,
  middleMessageId: number,
): { langId: string; postKey: string; changed: boolean } | undefined {
  const found = findTrackedMiddleMessage(store, middleChatId, middleMessageId);
  if (!found) {
    return undefined;
  }
  if (found.middleMessage.touched) {
    return { langId: found.langId, postKey: found.postKey, changed: false };
  }
  found.middleMessage.touched = true;
  return { langId: found.langId, postKey: found.postKey, changed: true };
}

export function buildMiddleReplyMarkup(
  isBeta: boolean,
  upstreamChatId: number,
  replyToMessageId?: number,
): InlineKeyboardMarkup {
  const inline_keyboard: InlineKeyboardButton[][] = [
    [{ text: "Translate", callback_data: "translate" }],
    [
      {
        text: `Send to ${isBeta ? "Beta" : "Main"} Channel`,
        callback_data: `send_${isBeta ? "beta" : "tg"}`,
      },
    ],
  ];

  if (replyToMessageId !== undefined) {
    inline_keyboard.push([
      {
        text: "View Replied Post",
        url: linkMessage(upstreamChatId, replyToMessageId),
      },
    ]);
  }

  inline_keyboard.push([{ text: "Idle", callback_data: "idle" }]);

  return { inline_keyboard };
}

export function extractPostHashtags(message: Message): string[] {
  if (message.rich_message) {
    return extractRichMessageHashtags(message.rich_message);
  }
  const sourceText = message.text ?? message.caption;
  const entities = message.entities ?? message.caption_entities;
  if (!sourceText || !entities?.length) {
    return [];
  }
  return entities
    .filter((entity) => entity.type === "hashtag")
    .map((entity) => sourceText.slice(entity.offset, entity.offset + entity.length));
}

export function isBetaChannelPost(
  channel: UpstreamChannelInfo,
  message: Message,
): boolean {
  if (channel.flags?.includes("beta")) {
    return true;
  }
  if (!channel.flags?.includes("alt")) {
    return false;
  }
  return extractPostHashtags(message).some(
    (v) => v.toLowerCase() === "#betainfo",
  );
}

export function extractEditableMedia(
  message: Message,
): ExtractedMedia | undefined {
  if (message.photo?.length) {
    const largest = message.photo[message.photo.length - 1];
    return {
      type: "photo",
      fileId: largest.file_id,
      fileUniqueId: largest.file_unique_id,
    };
  }
  if (message.video) {
    return {
      type: "video",
      fileId: message.video.file_id,
      fileUniqueId: message.video.file_unique_id,
    };
  }
  if (message.animation) {
    return {
      type: "animation",
      fileId: message.animation.file_id,
      fileUniqueId: message.animation.file_unique_id,
    };
  }
  if (message.audio) {
    return {
      type: "audio",
      fileId: message.audio.file_id,
      fileUniqueId: message.audio.file_unique_id,
    };
  }
  if (message.document) {
    return {
      type: "document",
      fileId: message.document.file_id,
      fileUniqueId: message.document.file_unique_id,
    };
  }
  return undefined;
}

export function buildInputMedia(message: Message): InputMedia | undefined {
  const captionFields = {
    ...(message.caption !== undefined ? { caption: message.caption } : {}),
    ...(message.caption_entities !== undefined
      ? { caption_entities: message.caption_entities }
      : {}),
  };

  if (message.photo?.length) {
    const largest = message.photo[message.photo.length - 1];
    const media: InputMediaPhoto = {
      type: "photo",
      media: largest.file_id,
      ...captionFields,
      ...(message.show_caption_above_media
        ? { show_caption_above_media: true }
        : {}),
      ...(message.has_media_spoiler ? { has_spoiler: true } : {}),
    };
    return media;
  }

  if (message.video) {
    const cover = message.video.cover?.length
      ? message.video.cover[message.video.cover.length - 1].file_id
      : undefined;
    const media: InputMediaVideo = {
      type: "video",
      media: message.video.file_id,
      ...captionFields,
      ...(message.show_caption_above_media
        ? { show_caption_above_media: true }
        : {}),
      ...(message.video.width ? { width: message.video.width } : {}),
      ...(message.video.height ? { height: message.video.height } : {}),
      ...(message.video.duration ? { duration: message.video.duration } : {}),
      ...(cover !== undefined ? { cover } : {}),
      ...(message.video.start_timestamp !== undefined
        ? { start_timestamp: message.video.start_timestamp }
        : {}),
      ...(message.has_media_spoiler ? { has_spoiler: true } : {}),
    };
    return media;
  }

  if (message.animation) {
    const media: InputMediaAnimation = {
      type: "animation",
      media: message.animation.file_id,
      ...captionFields,
      ...(message.show_caption_above_media
        ? { show_caption_above_media: true }
        : {}),
      ...(message.animation.width ? { width: message.animation.width } : {}),
      ...(message.animation.height ? { height: message.animation.height } : {}),
      ...(message.animation.duration
        ? { duration: message.animation.duration }
        : {}),
      ...(message.has_media_spoiler ? { has_spoiler: true } : {}),
    };
    return media;
  }

  if (message.audio) {
    const media: InputMediaAudio = {
      type: "audio",
      media: message.audio.file_id,
      ...captionFields,
      ...(message.audio.duration ? { duration: message.audio.duration } : {}),
      ...(message.audio.performer !== undefined
        ? { performer: message.audio.performer }
        : {}),
      ...(message.audio.title !== undefined
        ? { title: message.audio.title }
        : {}),
    };
    return media;
  }

  if (message.document) {
    const media: InputMediaDocument = {
      type: "document",
      media: message.document.file_id,
      ...captionFields,
    };
    return media;
  }

  return undefined;
}

function normalizeEntities(
  entities: readonly MessageEntity[] | undefined,
): unknown[] {
  if (!entities?.length) {
    return [];
  }
  return entities.map((e) => {
    const base: Record<string, unknown> = {
      type: e.type,
      offset: e.offset,
      length: e.length,
    };
    if ("url" in e && e.url !== undefined) base.url = e.url;
    if ("language" in e && e.language !== undefined) base.language = e.language;
    if ("custom_emoji_id" in e && e.custom_emoji_id !== undefined) {
      base.custom_emoji_id = e.custom_emoji_id;
    }
    if ("user" in e && e.user !== undefined) base.userId = e.user.id;
    if ("unix_time" in e && e.unix_time !== undefined) {
      base.unix_time = e.unix_time;
    }
    if ("date_time_format" in e && e.date_time_format !== undefined) {
      base.date_time_format = e.date_time_format;
    }
    return base;
  });
}

function canonicalizeRichText(richText: RichText): unknown {
  if (typeof richText === "string") {
    return richText;
  }
  if (Array.isArray(richText)) {
    return richText.map(canonicalizeRichText);
  }
  switch (richText.type) {
    case "custom_emoji":
      return {
        type: richText.type,
        id: richText.custom_emoji_id,
        alt: richText.alternative_text,
      };
    case "mathematical_expression":
      return { type: richText.type, expression: richText.expression };
    case "anchor":
      return { type: richText.type, name: richText.name };
    case "button":
      return {
        type: richText.type,
        text: canonicalizeRichText(richText.button.text),
      };
    default: {
      const result: Record<string, unknown> = {
        type: richText.type,
        text: canonicalizeRichText(richText.text),
      };
      if ("url" in richText && richText.url !== undefined) {
        result.url = richText.url;
      }
      if ("name" in richText && richText.name !== undefined) {
        result.name = richText.name;
      }
      if ("hashtag" in richText && richText.hashtag !== undefined) {
        result.hashtag = richText.hashtag;
      }
      return result;
    }
  }
}

function canonicalizeRichCaption(caption?: RichBlockCaption): unknown {
  if (!caption) return null;
  return {
    text: canonicalizeRichText(caption.text),
    credit: caption.credit !== undefined
      ? canonicalizeRichText(caption.credit)
      : null,
  };
}

function canonicalizeRichBlock(block: RichBlock): unknown {
  switch (block.type) {
    case "paragraph":
    case "footer":
    case "thinking":
      return { type: block.type, text: canonicalizeRichText(block.text) };
    case "heading":
      return {
        type: block.type,
        size: block.size,
        text: canonicalizeRichText(block.text),
      };
    case "pre":
      return {
        type: block.type,
        text: block.text,
        language: block.language ?? null,
      };
    case "divider":
      return { type: block.type };
    case "mathematical_expression":
      return { type: block.type, expression: block.expression };
    case "anchor":
      return { type: block.type, name: block.name };
    case "list":
      return {
        type: block.type,
        items: block.items.map((item) => ({
          blocks: item.blocks.map(canonicalizeRichBlock),
          has_checkbox: Boolean(item.has_checkbox),
          is_checked: Boolean(item.is_checked),
          label: item.label ?? null,
        })),
      };
    case "blockquote":
    case "expandable_blockquote":
      return {
        type: block.type,
        blocks: block.blocks.map(canonicalizeRichBlock),
        credit: block.credit !== undefined
          ? canonicalizeRichText(block.credit)
          : null,
      };
    case "pullquote":
      return {
        type: block.type,
        text: canonicalizeRichText(block.text),
        credit: block.credit !== undefined
          ? canonicalizeRichText(block.credit)
          : null,
      };
    case "collage":
    case "slideshow":
      return {
        type: block.type,
        blocks: block.blocks.map(canonicalizeRichBlock),
        caption: canonicalizeRichCaption(block.caption),
      };
    case "table":
      return {
        type: block.type,
        caption: block.caption !== undefined
          ? canonicalizeRichText(block.caption)
          : null,
        cells: block.cells.map((row) =>
          row.map((cell) => ({
            text: cell.text !== undefined
              ? canonicalizeRichText(cell.text)
              : null,
            is_header: Boolean(cell.is_header),
          }))
        ),
      };
    case "details":
      return {
        type: block.type,
        summary: canonicalizeRichText(block.summary),
        blocks: block.blocks.map(canonicalizeRichBlock),
        is_open: Boolean(block.is_open),
      };
    case "map":
      return {
        type: block.type,
        lat: block.location.latitude,
        lon: block.location.longitude,
        zoom: block.zoom,
        caption: canonicalizeRichCaption(block.caption),
      };
    case "photo":
      return {
        type: block.type,
        fileUniqueId: block.photo[block.photo.length - 1]?.file_unique_id ??
          null,
        hasSpoiler: Boolean(block.has_spoiler),
        caption: canonicalizeRichCaption(block.caption),
      };
    case "video":
      return {
        type: block.type,
        fileUniqueId: block.video.file_unique_id,
        hasSpoiler: Boolean(block.has_spoiler),
        caption: canonicalizeRichCaption(block.caption),
      };
    case "animation":
      return {
        type: block.type,
        fileUniqueId: block.animation.file_unique_id,
        hasSpoiler: Boolean(block.has_spoiler),
        caption: canonicalizeRichCaption(block.caption),
      };
    case "audio":
      return {
        type: block.type,
        fileUniqueId: block.audio.file_unique_id,
        caption: canonicalizeRichCaption(block.caption),
      };
    case "document":
      return {
        type: block.type,
        fileUniqueId: block.document.file_unique_id,
        caption: canonicalizeRichCaption(block.caption),
      };
    case "voice_note":
      return {
        type: block.type,
        fileUniqueId: block.voice_note.file_unique_id,
        caption: canonicalizeRichCaption(block.caption),
      };
    case "buttons":
      return {
        type: block.type,
        buttons: block.buttons.map((b) => canonicalizeRichText(b.text)),
      };
  }
}

export function computeMessageFingerprint(
  message: Message,
  options?: { ghostImageUrl?: string },
): string {
  if (options?.ghostImageUrl) {
    return JSON.stringify({
      kind: "text",
      text: message.caption ?? message.text ?? "",
      entities: normalizeEntities(message.caption_entities ?? message.entities),
      linkPreviewUrl: options.ghostImageUrl,
      linkPreviewDisabled: false,
      linkPreviewShowAboveText: true,
      linkPreviewPreferLargeMedia: true,
      linkPreviewPreferSmallMedia: false,
    });
  }

  if (message.rich_message) {
    return JSON.stringify({
      kind: "rich_message",
      isRtl: Boolean(message.rich_message.is_rtl),
      blocks: message.rich_message.blocks.map(canonicalizeRichBlock),
    });
  }

  if (message.text !== undefined) {
    return JSON.stringify({
      kind: "text",
      text: message.text,
      entities: normalizeEntities(message.entities),
      linkPreviewUrl: message.link_preview_options?.url ?? null,
      linkPreviewDisabled: Boolean(message.link_preview_options?.is_disabled),
      linkPreviewShowAboveText: Boolean(
        message.link_preview_options?.show_above_text,
      ),
      linkPreviewPreferLargeMedia: Boolean(
        message.link_preview_options?.prefer_large_media,
      ),
      linkPreviewPreferSmallMedia: Boolean(
        message.link_preview_options?.prefer_small_media,
      ),
    });
  }

  const media = extractEditableMedia(message);
  return JSON.stringify({
    kind: "media",
    caption: message.caption ?? "",
    entities: normalizeEntities(message.caption_entities),
    mediaType: media?.type ?? null,
    mediaFileUniqueId: media?.fileUniqueId ?? null,
    showCaptionAboveMedia: Boolean(message.show_caption_above_media),
    hasSpoiler: Boolean(message.has_media_spoiler),
  });
}

export function shouldMarkTouchedOnMiddleEdit(
  middleMsg: TrackedMiddleMessage,
  editedMessage: Message,
  pendingExpectedFingerprint?: string,
): boolean {
  if (middleMsg.touched || middleMsg.deleted) {
    return false;
  }
  const incoming = computeMessageFingerprint(editedMessage);
  if (
    pendingExpectedFingerprint !== undefined &&
    incoming === pendingExpectedFingerprint
  ) {
    return false;
  }
  if (
    middleMsg.lastSyncedFingerprint !== undefined &&
    incoming === middleMsg.lastSyncedFingerprint
  ) {
    return false;
  }
  return true;
}

export function getErrorDescription(err: unknown): string {
  if (err && typeof err === "object" && "description" in err) {
    const desc = (err as { description?: unknown }).description;
    if (typeof desc === "string") {
      return desc;
    }
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

export function isGrammyNotModifiedError(err: unknown): boolean {
  const desc = getErrorDescription(err).toLowerCase();
  return desc.includes("message is not modified");
}

export function isGrammyMessageNotFoundError(err: unknown): boolean {
  const desc = getErrorDescription(err).toLowerCase();
  return (
    desc.includes("message to edit not found") ||
    desc.includes("message to delete not found") ||
    desc.includes("message_id_invalid") ||
    desc.includes("message not found")
  );
}

export function findUpstreamChannel(
  channels: ChannelsConfig,
  chatId: number,
): UpstreamChannelInfo | undefined {
  const key = String(chatId);
  for (const group of Object.values(channels)) {
    if (key in group) {
      return group[key];
    }
  }
  return undefined;
}

function findUpstreamChannelByName(
  channels: ChannelsConfig,
  rawName: string,
): { chatId: number; channel: UpstreamChannelInfo } | undefined {
  const normalized = rawName.trim().replace(/^@/, "").toLowerCase();
  const compact = normalized.replace(/[-_]/g, "");
  if (!normalized) return undefined;

  for (const group of Object.values(channels)) {
    for (const [chatIdStr, info] of Object.entries(group)) {
      const infoName = info.name.trim().replace(/^@/, "").toLowerCase();
      if (infoName === normalized || infoName.replace(/[-_]/g, "") === compact) {
        return { chatId: Number(chatIdStr), channel: info };
      }
    }
  }
  return undefined;
}

export interface ParsedUpstreamPostReference {
  chatId: number;
  messageId: number;
  channel: UpstreamChannelInfo;
}

export function parseUpstreamPostReference(
  input: string,
  channels: ChannelsConfig,
): ParsedUpstreamPostReference | { error: string } | undefined {
  const trimmed = input.trim();
  if (!trimmed) {
    return undefined;
  }

  // 1. Private/supergroup link: https://t.me/c/<internalId>/<messageId>
  const privateLinkMatch = trimmed.match(
    /(?:https?:\/\/)?(?:t\.me|telegram\.me|telegram\.dog)\/c\/(\d+)\/(\d+)/i,
  );
  if (privateLinkMatch) {
    const chatId = Number(`-100${privateLinkMatch[1]}`);
    const messageId = Number(privateLinkMatch[2]);
    const channel = findUpstreamChannel(channels, chatId);
    if (!channel) {
      return { error: `Channel ${chatId} is not a known upstream channel.` };
    }
    return { chatId, messageId, channel };
  }

  // 2. Telegram privatepost deep link: tg://privatepost?channel=<internalId>&post=<messageId>
  const tgPrivateMatch = trimmed.match(
    /tg:\/\/privatepost\?[^\s]*channel=(\d+)[^\s]*post=(\d+)|tg:\/\/privatepost\?[^\s]*post=(\d+)[^\s]*channel=(\d+)/i,
  );
  if (tgPrivateMatch) {
    const internalId = tgPrivateMatch[1] ?? tgPrivateMatch[4];
    const messageId = Number(tgPrivateMatch[2] ?? tgPrivateMatch[3]);
    const chatId = Number(`-100${internalId}`);
    const channel = findUpstreamChannel(channels, chatId);
    if (!channel) {
      return { error: `Channel ${chatId} is not a known upstream channel.` };
    }
    return { chatId, messageId, channel };
  }

  // 3. Telegram resolve deep link: tg://resolve?domain=<username>&post=<messageId>
  const tgResolveMatch = trimmed.match(
    /tg:\/\/resolve\?[^\s]*domain=([a-zA-Z0-9_]{4,})[^\s]*post=(\d+)|tg:\/\/resolve\?[^\s]*post=(\d+)[^\s]*domain=([a-zA-Z0-9_]{4,})/i,
  );
  if (tgResolveMatch) {
    const username = tgResolveMatch[1] ?? tgResolveMatch[4];
    const messageId = Number(tgResolveMatch[2] ?? tgResolveMatch[3]);
    const matched = findUpstreamChannelByName(channels, username);
    if (!matched) {
      return { error: `Channel @${username} is not a known upstream channel.` };
    }
    return { chatId: matched.chatId, messageId, channel: matched.channel };
  }

  // 4. Public channel link: https://t.me/<username>/<messageId>
  const publicLinkMatch = trimmed.match(
    /(?:https?:\/\/)?(?:t\.me|telegram\.me|telegram\.dog)\/([a-zA-Z0-9_]{4,})\/(\d+)/i,
  );
  if (publicLinkMatch) {
    const username = publicLinkMatch[1];
    const messageId = Number(publicLinkMatch[2]);
    const matched = findUpstreamChannelByName(channels, username);
    if (!matched) {
      return { error: `Channel @${username} is not a known upstream channel.` };
    }
    return { chatId: matched.chatId, messageId, channel: matched.channel };
  }

  // 5. Explicit shorthand: "<chatId|@username|channelName> <messageId>" or "<chatId>:<messageId>"
  const shorthandMatch = trimmed.match(
    /^(-100\d+|@?[a-zA-Z0-9_-]+)[\s:]+(\d+)$/,
  );
  if (shorthandMatch) {
    const target = shorthandMatch[1];
    const messageId = Number(shorthandMatch[2]);
    if (target.startsWith("-100")) {
      const chatId = Number(target);
      const channel = findUpstreamChannel(channels, chatId);
      if (!channel) {
        return { error: `Channel ${chatId} is not a known upstream channel.` };
      }
      return { chatId, messageId, channel };
    }
    const matched = findUpstreamChannelByName(channels, target);
    if (!matched) {
      return { error: `Channel ${target} is not a known upstream channel.` };
    }
    return { chatId: matched.chatId, messageId, channel: matched.channel };
  }

  return {
    error:
      "Could not parse upstream post reference. Pass a Telegram post link (e.g. https://t.me/tginfo/123 or https://t.me/c/1719500532/123) or `<channel> <message_id>` (e.g. `rualt 123` or `enalt 123`).",
  };
}

export function extractUpstreamPostReferenceFromReply(
  repliedMessage: Message,
  channels: ChannelsConfig,
): ParsedUpstreamPostReference | { error: string } | undefined {
  if (
    repliedMessage.forward_origin &&
    repliedMessage.forward_origin.type === "channel"
  ) {
    const chatId = repliedMessage.forward_origin.chat.id;
    const messageId = repliedMessage.forward_origin.message_id;
    const channel = findUpstreamChannel(channels, chatId);
    if (!channel) {
      return { error: `Channel ${chatId} is not a known upstream channel.` };
    }
    return { chatId, messageId, channel };
  }

  const entities = repliedMessage.entities ?? repliedMessage.caption_entities ??
    [];
  const text = repliedMessage.text ?? repliedMessage.caption ?? "";

  for (const entity of entities) {
    let candidateUrl: string | undefined;
    if (entity.type === "text_link") {
      candidateUrl = entity.url;
    } else if (entity.type === "url") {
      candidateUrl = text.slice(entity.offset, entity.offset + entity.length);
    }
    if (candidateUrl) {
      const parsed = parseUpstreamPostReference(candidateUrl, channels);
      if (parsed && !("error" in parsed)) {
        return parsed;
      }
    }
  }

  if (text) {
    const linkMatch = text.match(
      /(?:https?:\/\/)?(?:t\.me|telegram\.me|telegram\.dog)\/(?:c\/\d+|[a-zA-Z0-9_]{4,})\/\d+|tg:\/\/(?:privatepost|resolve)\?[^\s]+/i,
    );
    if (linkMatch) {
      return parseUpstreamPostReference(linkMatch[0], channels);
    }
  }

  if (repliedMessage.reply_markup?.inline_keyboard) {
    for (const row of repliedMessage.reply_markup.inline_keyboard) {
      for (const button of row) {
        if ("url" in button && button.url) {
          const parsed = parseUpstreamPostReference(button.url, channels);
          if (parsed && !("error" in parsed)) {
            return parsed;
          }
        }
      }
    }
  }

  return undefined;
}

export async function syncUpstreamEditToMiddleChannels(options: {
  trackedPost: TrackedPost;
  editedPost: Message;
  channel: UpstreamChannelInfo;
  api: MiddleEditApi;
  pendingSyncFingerprints?: Map<string, string>;
  uploadGhostImage?: () => Promise<
    { url: string; fileUniqueId: string } | undefined
  >;
}): Promise<EditSyncResult> {
  const {
    trackedPost,
    editedPost,
    channel,
    api,
    pendingSyncFingerprints,
    uploadGhostImage,
  } = options;

  const result: EditSyncResult = {
    updated: [],
    unchanged: [],
    skippedTouched: [],
    alreadyDeleted: [],
    failed: [],
    longCaptionUnhandled: false,
    mutated: false,
  };

  const newIsBeta = isBetaChannelPost(channel, editedPost);
  if (trackedPost.isBeta !== newIsBeta) {
    trackedPost.isBeta = newIsBeta;
    result.mutated = true;
  }

  const replyMarkup = buildMiddleReplyMarkup(
    newIsBeta,
    trackedPost.upstreamChatId,
    trackedPost.replyToMessageId,
  );
  const currentMedia = extractEditableMedia(editedPost);
  const captionTooLong = Boolean(
    editedPost.caption && editedPost.caption.length > MAX_CAPTION_LENGTH,
  );

  let cachedGhostUpload:
    | { url: string; fileUniqueId: string }
    | null
    | undefined;
  const ensureGhostUpload = async (): Promise<
    { url: string; fileUniqueId: string } | undefined
  > => {
    if (cachedGhostUpload !== undefined) {
      return cachedGhostUpload ?? undefined;
    }
    if (!uploadGhostImage) {
      cachedGhostUpload = null;
      return undefined;
    }
    const uploaded = await uploadGhostImage();
    cachedGhostUpload = uploaded ?? null;
    return uploaded;
  };

  for (const [langId, middleMsg] of Object.entries(trackedPost.middleMessages)) {
    if (middleMsg.deleted) {
      result.alreadyDeleted.push(langId);
      continue;
    }
    if (middleMsg.touched) {
      result.skippedTouched.push(langId);
      continue;
    }

    const middleKey = getMiddleMessageKey(
      middleMsg.chatId,
      middleMsg.messageId,
    );

    try {
      if (editedPost.rich_message && middleMsg.kind === "rich_message") {
        const expectedFp = computeMessageFingerprint(editedPost);
        pendingSyncFingerprints?.set(middleKey, expectedFp);
        try {
          const edited = await api.editMessageText(
            middleMsg.chatId,
            middleMsg.messageId,
            toInputRichMessage(editedPost.rich_message),
            { reply_markup: replyMarkup },
          );
          middleMsg.lastSyncedFingerprint = typeof edited === "object"
            ? computeMessageFingerprint(edited)
            : expectedFp;
          result.updated.push(langId);
          result.mutated = true;
        } finally {
          pendingSyncFingerprints?.delete(middleKey);
        }
        continue;
      }

      if (middleMsg.kind === "ghost_text") {
        const text = editedPost.caption ?? editedPost.text;
        if (!text) {
          result.failed.push({
            langId,
            error: "Edited post has no text or caption.",
          });
          continue;
        }

        let ghostImageUrl = middleMsg.ghostImageUrl;
        let mediaFileUniqueId = middleMsg.mediaFileUniqueId;
        const imageChanged = Boolean(
          currentMedia &&
            currentMedia.fileUniqueId !== middleMsg.mediaFileUniqueId,
        );
        if (imageChanged) {
          const uploaded = await ensureGhostUpload();
          if (uploaded) {
            ghostImageUrl = uploaded.url;
            mediaFileUniqueId = uploaded.fileUniqueId;
          }
        }

        const expectedFp = computeMessageFingerprint(editedPost, {
          ghostImageUrl,
        });
        pendingSyncFingerprints?.set(middleKey, expectedFp);
        try {
          const edited = await api.editMessageText(
            middleMsg.chatId,
            middleMsg.messageId,
            text,
            {
              entities: editedPost.caption_entities ?? editedPost.entities,
              link_preview_options: ghostImageUrl
                ? {
                  url: ghostImageUrl,
                  show_above_text: true,
                  prefer_large_media: true,
                }
                : undefined,
              reply_markup: replyMarkup,
            },
          );
          middleMsg.ghostImageUrl = ghostImageUrl;
          middleMsg.mediaFileUniqueId = mediaFileUniqueId;
          middleMsg.lastSyncedFingerprint = typeof edited === "object"
            ? computeMessageFingerprint(edited)
            : expectedFp;
          result.updated.push(langId);
          result.mutated = true;
        } finally {
          pendingSyncFingerprints?.delete(middleKey);
        }
        continue;
      }

      if (editedPost.text !== undefined && middleMsg.kind === "text") {
        const expectedFp = computeMessageFingerprint(editedPost);
        pendingSyncFingerprints?.set(middleKey, expectedFp);
        try {
          const edited = await api.editMessageText(
            middleMsg.chatId,
            middleMsg.messageId,
            editedPost.text,
            {
              entities: editedPost.entities,
              link_preview_options: editedPost.link_preview_options,
              reply_markup: replyMarkup,
            },
          );
          middleMsg.lastSyncedFingerprint = typeof edited === "object"
            ? computeMessageFingerprint(edited)
            : expectedFp;
          result.updated.push(langId);
          result.mutated = true;
        } finally {
          pendingSyncFingerprints?.delete(middleKey);
        }
        continue;
      }

      if (middleMsg.kind === "media" && captionTooLong) {
        const uploaded = await ensureGhostUpload();
        if (!uploaded) {
          result.longCaptionUnhandled = true;
          result.failed.push({
            langId,
            error: "Edited caption exceeds 1024 characters and could not be converted via Ghost.",
          });
          continue;
        }

        const sent = await api.sendMessage(
          middleMsg.chatId,
          editedPost.caption!,
          {
            entities: editedPost.caption_entities,
            link_preview_options: {
              url: uploaded.url,
              show_above_text: true,
              prefer_large_media: true,
            },
            reply_markup: replyMarkup,
          },
        );
        const oldMessageId = middleMsg.messageId;
        middleMsg.messageId = sent.message_id;
        middleMsg.kind = "ghost_text";
        middleMsg.ghostImageUrl = uploaded.url;
        middleMsg.mediaFileUniqueId = uploaded.fileUniqueId;
        middleMsg.mediaType = undefined;
        middleMsg.lastSyncedFingerprint = computeMessageFingerprint(sent);
        result.updated.push(langId);
        result.mutated = true;

        try {
          await api.deleteMessage(middleMsg.chatId, oldMessageId);
        } catch {
          // Best-effort cleanup of the old media message after sending replacement.
        }
        continue;
      }

      if (currentMedia) {
        const mediaChanged =
          middleMsg.kind !== "media" ||
          (middleMsg.mediaFileUniqueId !== undefined &&
            currentMedia.fileUniqueId !== middleMsg.mediaFileUniqueId) ||
          (middleMsg.mediaType !== undefined &&
            currentMedia.type !== middleMsg.mediaType);

        const expectedFp = computeMessageFingerprint(editedPost);
        pendingSyncFingerprints?.set(middleKey, expectedFp);
        try {
          let edited: Message | true;
          if (mediaChanged) {
            const inputMedia = buildInputMedia(editedPost);
            if (!inputMedia) {
              result.failed.push({
                langId,
                error: "Unsupported media type for editMessageMedia.",
              });
              continue;
            }
            edited = await api.editMessageMedia(
              middleMsg.chatId,
              middleMsg.messageId,
              inputMedia,
              { reply_markup: replyMarkup },
            );
            middleMsg.kind = "media";
            middleMsg.mediaType = currentMedia.type;
            middleMsg.mediaFileUniqueId = currentMedia.fileUniqueId;
          } else {
            edited = await api.editMessageCaption(
              middleMsg.chatId,
              middleMsg.messageId,
              {
                caption: editedPost.caption ?? "",
                caption_entities: editedPost.caption_entities,
                show_caption_above_media: editedPost.show_caption_above_media,
                reply_markup: replyMarkup,
              },
            );
          }
          middleMsg.lastSyncedFingerprint = typeof edited === "object"
            ? computeMessageFingerprint(edited)
            : expectedFp;
          result.updated.push(langId);
          result.mutated = true;
        } finally {
          pendingSyncFingerprints?.delete(middleKey);
        }
        continue;
      }

      if (middleMsg.kind === "media" && editedPost.caption !== undefined) {
        const expectedFp = computeMessageFingerprint(editedPost);
        pendingSyncFingerprints?.set(middleKey, expectedFp);
        try {
          const edited = await api.editMessageCaption(
            middleMsg.chatId,
            middleMsg.messageId,
            {
              caption: editedPost.caption,
              caption_entities: editedPost.caption_entities,
              show_caption_above_media: editedPost.show_caption_above_media,
              reply_markup: replyMarkup,
            },
          );
          middleMsg.lastSyncedFingerprint = typeof edited === "object"
            ? computeMessageFingerprint(edited)
            : expectedFp;
          result.updated.push(langId);
          result.mutated = true;
        } finally {
          pendingSyncFingerprints?.delete(middleKey);
        }
        continue;
      }

      result.failed.push({
        langId,
        error: `Incompatible message edit for middle kind "${middleMsg.kind}".`,
      });
    } catch (err) {
      if (isGrammyNotModifiedError(err)) {
        result.unchanged.push(langId);
      } else if (isGrammyMessageNotFoundError(err)) {
        middleMsg.deleted = true;
        result.alreadyDeleted.push(langId);
        result.mutated = true;
      } else {
        result.failed.push({ langId, error: getErrorDescription(err) });
      }
    }
  }

  return result;
}

export async function deleteUpstreamPostFromMiddleChannels(options: {
  trackedPost: TrackedPost;
  api: MiddleDeleteApi;
}): Promise<DeleteSyncResult> {
  const { trackedPost, api } = options;

  const result: DeleteSyncResult = {
    deleted: [],
    skippedTouched: [],
    alreadyDeleted: [],
    failed: [],
    mutated: false,
  };

  for (const [langId, middleMsg] of Object.entries(trackedPost.middleMessages)) {
    if (middleMsg.deleted) {
      result.alreadyDeleted.push(langId);
      continue;
    }
    if (middleMsg.touched) {
      result.skippedTouched.push(langId);
      continue;
    }

    try {
      await api.deleteMessage(middleMsg.chatId, middleMsg.messageId);
      middleMsg.deleted = true;
      result.deleted.push(langId);
      result.mutated = true;
    } catch (err) {
      if (isGrammyMessageNotFoundError(err)) {
        middleMsg.deleted = true;
        result.alreadyDeleted.push(langId);
        result.mutated = true;
      } else {
        result.failed.push({ langId, error: getErrorDescription(err) });
      }
    }
  }

  return result;
}

export function formatEditSummaryLines(result: EditSyncResult): string[] {
  const lines: string[] = [];
  if (result.updated.length > 0) {
    lines.push(
      `Updated (${result.updated.length}): ${result.updated.join(", ")}`,
    );
  }
  if (result.unchanged.length > 0) {
    lines.push(
      `Unchanged (${result.unchanged.length}): ${result.unchanged.join(", ")}`,
    );
  }
  if (result.skippedTouched.length > 0) {
    lines.push(
      `Skipped (touched by translators, ${result.skippedTouched.length}): ${
        result.skippedTouched.join(", ")
      }`,
    );
  }
  if (result.alreadyDeleted.length > 0) {
    lines.push(
      `Already deleted (${result.alreadyDeleted.length}): ${
        result.alreadyDeleted.join(", ")
      }`,
    );
  }
  if (result.failed.length > 0) {
    lines.push(
      `Failed (${result.failed.length}): ${
        result.failed.map((f) => f.langId).join(", ")
      }`,
    );
  }
  return lines;
}

export function formatDeleteSummaryLines(result: DeleteSyncResult): string[] {
  const lines: string[] = [];
  if (result.deleted.length > 0) {
    lines.push(
      `Deleted (${result.deleted.length}): ${result.deleted.join(", ")}`,
    );
  }
  if (result.skippedTouched.length > 0) {
    lines.push(
      `Skipped (touched by translators, ${result.skippedTouched.length}): ${
        result.skippedTouched.join(", ")
      }`,
    );
  }
  if (result.alreadyDeleted.length > 0) {
    lines.push(
      `Already deleted (${result.alreadyDeleted.length}): ${
        result.alreadyDeleted.join(", ")
      }`,
    );
  }
  if (result.failed.length > 0) {
    lines.push(
      `Failed (${result.failed.length}): ${
        result.failed.map((f) => f.langId).join(", ")
      }`,
    );
  }
  return lines;
}
