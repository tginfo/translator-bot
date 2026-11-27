import type {
  InputMediaAnimation,
  InputMediaAudio,
  InputMediaDocument,
  InputMediaPhoto,
  InputMediaVideo,
  InputMediaVoiceNote,
  InputRichBlock,
  InputRichBlockListItem,
  InputRichMessage,
  RichBlock,
  RichBlockCaption,
  RichBlockListItem,
  RichBlockTableCell,
  RichMessage,
  RichMessageButton,
  RichText,
} from "grammy/types.ts";
import {
  applyTypographyWithContext,
  isBareUrlText,
  splitTextPreservingSeparators,
  truncateText,
} from "./html_common.ts";
import {
  htmlToInputRichBlocks,
  isEmptyRichText,
  isGalleryMediaBlock,
  normalizeRichTextNodes,
  richMessageToTranslatableHtmlDocuments,
  sanitizeButtonRichText,
} from "./rich_message_html.ts";

export {
  createRichHtmlContext,
  htmlToInputRichBlocks,
  htmlToInputRichMessage,
  type HtmlToRichOptions,
  type RichHtmlChunk,
  type RichHtmlContext,
  type RichHtmlMode,
  richMessageToHtml,
  richMessageToTranslatableHtmlDocuments,
  sanitizeButtonRichText,
  type SerializedRichHtml,
} from "./rich_message_html.ts";

const MAX_RICH_MESSAGE_BLOCKS = 500;
const MAX_RICH_MESSAGE_CHARS = 32_000;
const MAX_TRANSLATE_HTML_DOC_CHARS = 24_000;

export function richTextToPlainText(richText: RichText): string {
  if (typeof richText === "string") {
    return richText;
  }
  if (Array.isArray(richText)) {
    return richText.map(richTextToPlainText).join("");
  }
  switch (richText.type) {
    case "custom_emoji":
      return richText.alternative_text;
    case "mathematical_expression":
      return richText.expression;
    case "anchor":
      return "";
    case "button":
      return richTextToPlainText(richText.button.text);
    default:
      return richTextToPlainText(richText.text);
  }
}

function formatCaptionPlainText(caption?: RichBlockCaption): string {
  if (!caption) return "";
  const text = richTextToPlainText(caption.text).trim();
  const credit = caption.credit
    ? richTextToPlainText(caption.credit).trim()
    : "";
  if (text && credit) return `${text}\n— ${credit}`;
  return text || credit;
}

function richBlockToPlainText(block: RichBlock): string {
  switch (block.type) {
    case "paragraph":
    case "heading":
    case "pre":
    case "footer":
    case "thinking":
      return richTextToPlainText(block.text);
    case "divider":
      return "---";
    case "mathematical_expression":
      return block.expression;
    case "anchor":
      return "";
    case "list":
      return block.items
        .map((item) => {
          const prefix = item.has_checkbox
            ? (item.is_checked ? "[x] " : "[ ] ")
            : item.label
            ? `${item.label} `
            : "• ";
          const body = item.blocks
            .map(richBlockToPlainText)
            .filter(Boolean)
            .join("\n");
          return body ? `${prefix}${body}` : "";
        })
        .filter(Boolean)
        .join("\n");
    case "blockquote":
    case "expandable_blockquote": {
      const body = block.blocks
        .map(richBlockToPlainText)
        .filter(Boolean)
        .join("\n");
      const credit = block.credit
        ? richTextToPlainText(block.credit).trim()
        : "";
      if (body && credit) return `${body}\n— ${credit}`;
      return body || credit;
    }
    case "pullquote": {
      const text = richTextToPlainText(block.text);
      const credit = block.credit
        ? richTextToPlainText(block.credit).trim()
        : "";
      if (text && credit) return `${text}\n— ${credit}`;
      return text || credit;
    }
    case "collage":
    case "slideshow": {
      const parts = block.blocks.map(richBlockToPlainText).filter(Boolean);
      const caption = formatCaptionPlainText(block.caption);
      if (caption) parts.push(caption);
      return parts.join("\n");
    }
    case "table": {
      const parts: string[] = [];
      if (block.caption) {
        const caption = richTextToPlainText(block.caption).trim();
        if (caption) parts.push(caption);
      }
      for (const row of block.cells) {
        const rowText = row
          .map((cell) => cell.text ? richTextToPlainText(cell.text).trim() : "")
          .join(" | ")
          .trim();
        if (rowText) parts.push(rowText);
      }
      return parts.join("\n");
    }
    case "details": {
      const parts: string[] = [];
      const summary = richTextToPlainText(block.summary).trim();
      if (summary) parts.push(summary);
      for (const child of block.blocks) {
        const text = richBlockToPlainText(child);
        if (text) parts.push(text);
      }
      return parts.join("\n");
    }
    case "map":
    case "animation":
    case "audio":
    case "document":
    case "photo":
    case "video":
    case "voice_note":
      return formatCaptionPlainText(block.caption);
    case "buttons":
      return block.buttons
        .map((button) => richTextToPlainText(button.text).trim())
        .filter(Boolean)
        .join(" | ");
    default:
      return "";
  }
}

export function richMessageToPlainText(richMessage: RichMessage): string {
  return richMessage.blocks
    .map(richBlockToPlainText)
    .filter((part) => part.trim().length > 0)
    .join("\n\n");
}

function collectHashtagsFromRichText(richText: RichText, out: string[]): void {
  if (typeof richText === "string") {
    return;
  }
  if (Array.isArray(richText)) {
    for (const child of richText) {
      collectHashtagsFromRichText(child, out);
    }
    return;
  }
  if (richText.type === "hashtag") {
    const raw = richText.hashtag || richTextToPlainText(richText.text);
    const trimmed = raw.trim();
    if (trimmed) {
      out.push(trimmed.startsWith("#") ? trimmed : `#${trimmed}`);
    }
    return;
  }
  if (
    richText.type === "custom_emoji" ||
    richText.type === "mathematical_expression" ||
    richText.type === "anchor"
  ) {
    return;
  }
  if (richText.type === "button") {
    collectHashtagsFromRichText(richText.button.text, out);
    return;
  }
  collectHashtagsFromRichText(richText.text, out);
}

function collectHashtagsFromCaption(
  caption: RichBlockCaption | undefined,
  out: string[],
): void {
  if (!caption) return;
  collectHashtagsFromRichText(caption.text, out);
  if (caption.credit !== undefined) {
    collectHashtagsFromRichText(caption.credit, out);
  }
}

function collectHashtagsFromBlock(block: RichBlock, out: string[]): void {
  switch (block.type) {
    case "paragraph":
    case "heading":
    case "pre":
    case "footer":
    case "thinking":
      collectHashtagsFromRichText(block.text, out);
      break;
    case "divider":
    case "mathematical_expression":
    case "anchor":
      break;
    case "list":
      for (const item of block.items) {
        for (const child of item.blocks) {
          collectHashtagsFromBlock(child, out);
        }
      }
      break;
    case "blockquote":
    case "expandable_blockquote":
      for (const child of block.blocks) {
        collectHashtagsFromBlock(child, out);
      }
      if (block.credit !== undefined) {
        collectHashtagsFromRichText(block.credit, out);
      }
      break;
    case "pullquote":
      collectHashtagsFromRichText(block.text, out);
      if (block.credit !== undefined) {
        collectHashtagsFromRichText(block.credit, out);
      }
      break;
    case "collage":
    case "slideshow":
      for (const child of block.blocks) {
        collectHashtagsFromBlock(child, out);
      }
      collectHashtagsFromCaption(block.caption, out);
      break;
    case "table":
      if (block.caption !== undefined) {
        collectHashtagsFromRichText(block.caption, out);
      }
      for (const row of block.cells) {
        for (const cell of row) {
          if (cell.text !== undefined) {
            collectHashtagsFromRichText(cell.text, out);
          }
        }
      }
      break;
    case "details":
      collectHashtagsFromRichText(block.summary, out);
      for (const child of block.blocks) {
        collectHashtagsFromBlock(child, out);
      }
      break;
    case "map":
    case "animation":
    case "audio":
    case "document":
    case "photo":
    case "video":
    case "voice_note":
      collectHashtagsFromCaption(block.caption, out);
      break;
    case "buttons":
      for (const button of block.buttons) {
        collectHashtagsFromRichText(button.text, out);
      }
      break;
  }
}

export function extractRichMessageHashtags(richMessage: RichMessage): string[] {
  const hashtags: string[] = [];
  for (const block of richMessage.blocks) {
    collectHashtagsFromBlock(block, hashtags);
  }
  return hashtags;
}

function mapCaption(
  caption: RichBlockCaption | undefined,
  transform: (text: RichText) => RichText,
): RichBlockCaption | undefined {
  if (!caption) return undefined;
  return {
    text: transform(caption.text),
    ...(caption.credit !== undefined
      ? { credit: transform(caption.credit) }
      : {}),
  };
}

function mapButton(
  button: RichMessageButton,
  transform: (text: RichText) => RichText,
): RichMessageButton {
  return {
    ...button,
    text: sanitizeButtonRichText(transform(button.text)),
  };
}

function toInputListItem(
  item: RichBlockListItem,
  transformBlock: (block: RichBlock) => InputRichBlock,
): InputRichBlockListItem {
  return {
    blocks: item.blocks.map(transformBlock),
    ...(item.has_checkbox ? { has_checkbox: item.has_checkbox } : {}),
    ...(item.is_checked ? { is_checked: item.is_checked } : {}),
    ...(item.value !== undefined ? { value: item.value } : {}),
    ...(item.type !== undefined ? { type: item.type } : {}),
  };
}

function mapRichBlockToInput(
  block: RichBlock,
  transformText: (text: RichText) => RichText,
): InputRichBlock {
  const recurse = (child: RichBlock) =>
    mapRichBlockToInput(child, transformText);

  switch (block.type) {
    case "paragraph":
      return {
        type: "paragraph",
        text: transformText(block.text),
      };
    case "heading":
      return {
        type: "heading",
        text: transformText(block.text),
        size: block.size,
      };
    case "pre":
      return {
        type: "pre",
        text: block.text,
        ...(block.language !== undefined ? { language: block.language } : {}),
      };
    case "footer":
      return {
        type: "footer",
        text: transformText(block.text),
      };
    case "divider":
      return { type: "divider" };
    case "mathematical_expression":
      return {
        type: "mathematical_expression",
        expression: block.expression,
      };
    case "anchor":
      return {
        type: "anchor",
        name: block.name,
      };
    case "list":
      return {
        type: "list",
        items: block.items.map((item) => toInputListItem(item, recurse)),
      };
    case "blockquote":
      return {
        type: "blockquote",
        blocks: block.blocks.map(recurse),
        ...(block.credit !== undefined
          ? { credit: transformText(block.credit) }
          : {}),
      };
    case "expandable_blockquote":
      return {
        type: "expandable_blockquote",
        blocks: block.blocks.map(recurse),
        ...(block.credit !== undefined
          ? { credit: transformText(block.credit) }
          : {}),
      };
    case "pullquote":
      return {
        type: "pullquote",
        text: transformText(block.text),
        ...(block.credit !== undefined
          ? { credit: transformText(block.credit) }
          : {}),
      };
    case "collage":
      return {
        type: "collage",
        blocks: block.blocks.map(recurse),
        ...(block.caption !== undefined
          ? { caption: mapCaption(block.caption, transformText) }
          : {}),
      };
    case "slideshow":
      return {
        type: "slideshow",
        blocks: block.blocks.map(recurse),
        ...(block.caption !== undefined
          ? { caption: mapCaption(block.caption, transformText) }
          : {}),
      };
    case "table":
      return {
        type: "table",
        cells: block.cells.map((row) =>
          row.map((cell): RichBlockTableCell => ({
            ...cell,
            ...(cell.text !== undefined
              ? { text: transformText(cell.text) }
              : {}),
          }))
        ),
        ...(block.is_bordered ? { is_bordered: block.is_bordered } : {}),
        ...(block.is_striped ? { is_striped: block.is_striped } : {}),
        ...(block.is_compact ? { is_compact: block.is_compact } : {}),
        ...(block.caption !== undefined
          ? { caption: transformText(block.caption) }
          : {}),
      };
    case "details":
      return {
        type: "details",
        summary: transformText(block.summary),
        blocks: block.blocks.map(recurse),
        ...(block.is_open ? { is_open: block.is_open } : {}),
      };
    case "map":
      return {
        type: "map",
        location: block.location,
        zoom: block.zoom,
        width: block.width,
        height: block.height,
        ...(block.caption !== undefined
          ? { caption: mapCaption(block.caption, transformText) }
          : {}),
      };
    case "animation": {
      const animation: InputMediaAnimation = {
        type: "animation",
        media: block.animation.file_id,
        width: block.animation.width,
        height: block.animation.height,
        duration: block.animation.duration,
        ...(block.has_spoiler ? { has_spoiler: true } : {}),
      };
      return {
        type: "animation",
        animation,
        ...(block.caption !== undefined
          ? { caption: mapCaption(block.caption, transformText) }
          : {}),
      };
    }
    case "audio": {
      const audio: InputMediaAudio = {
        type: "audio",
        media: block.audio.file_id,
        duration: block.audio.duration,
        ...(block.audio.performer !== undefined
          ? { performer: block.audio.performer }
          : {}),
        ...(block.audio.title !== undefined
          ? { title: block.audio.title }
          : {}),
      };
      return {
        type: "audio",
        audio,
        ...(block.caption !== undefined
          ? { caption: mapCaption(block.caption, transformText) }
          : {}),
      };
    }
    case "document": {
      const document: InputMediaDocument = {
        type: "document",
        media: block.document.file_id,
      };
      return {
        type: "document",
        document,
        ...(block.caption !== undefined
          ? { caption: mapCaption(block.caption, transformText) }
          : {}),
      };
    }
    case "photo": {
      const largest = block.photo[block.photo.length - 1];
      const photo: InputMediaPhoto = {
        type: "photo",
        media: largest.file_id,
        ...(block.has_spoiler ? { has_spoiler: true } : {}),
      };
      return {
        type: "photo",
        photo,
        ...(block.caption !== undefined
          ? { caption: mapCaption(block.caption, transformText) }
          : {}),
      };
    }
    case "video": {
      const cover = block.video.cover?.length
        ? block.video.cover[block.video.cover.length - 1].file_id
        : undefined;
      const video: InputMediaVideo = {
        type: "video",
        media: block.video.file_id,
        width: block.video.width,
        height: block.video.height,
        duration: block.video.duration,
        ...(cover !== undefined ? { cover } : {}),
        ...(block.video.start_timestamp !== undefined
          ? { start_timestamp: block.video.start_timestamp }
          : {}),
        ...(block.has_spoiler ? { has_spoiler: true } : {}),
      };
      return {
        type: "video",
        video,
        ...(block.caption !== undefined
          ? { caption: mapCaption(block.caption, transformText) }
          : {}),
      };
    }
    case "voice_note": {
      const voice_note: InputMediaVoiceNote = {
        type: "voice_note",
        media: block.voice_note.file_id,
        duration: block.voice_note.duration,
      };
      return {
        type: "voice_note",
        voice_note,
        ...(block.caption !== undefined
          ? { caption: mapCaption(block.caption, transformText) }
          : {}),
      };
    }
    case "buttons":
      return {
        type: "buttons",
        buttons: block.buttons.map((button) =>
          mapButton(button, transformText)
        ),
        ...(block.align !== undefined ? { align: block.align } : {}),
      };
    case "thinking":
      return {
        type: "thinking",
        text: transformText(block.text),
      };
  }
}

export function toInputRichMessage(richMessage: RichMessage): InputRichMessage {
  return {
    blocks: richMessage.blocks.map((block) =>
      mapRichBlockToInput(block, (text) => text)
    ),
    ...(richMessage.is_rtl !== undefined ? { is_rtl: richMessage.is_rtl } : {}),
  };
}

function measureBlockHtml(block: RichBlock): number {
  const { documents } = richMessageToTranslatableHtmlDocuments(
    { blocks: [block] },
    Number.MAX_SAFE_INTEGER,
  );
  return documents[0]?.html.length ?? 0;
}

function extractRichTextFromBlocks(
  blocks: readonly InputRichBlock[] | undefined,
  fallback: RichText,
): RichText {
  if (!blocks || blocks.length === 0) return fallback;
  const parts: RichText[] = [];
  for (const block of blocks) {
    if (block.type === "paragraph" && !isEmptyRichText(block.text)) {
      if (parts.length > 0) parts.push("\n");
      parts.push(block.text);
    }
  }
  return parts.length > 0 ? normalizeRichTextNodes(parts) : fallback;
}

async function translateRichTextChunked(
  richText: RichText,
  translateHtmlDocuments: (htmlDocs: string[]) => Promise<string[]>,
  maxDocChars: number,
): Promise<RichText> {
  const probeBlock: RichBlock = { type: "paragraph", text: richText };
  if (measureBlockHtml(probeBlock) <= maxDocChars) {
    const res = await translateRichMessageHtml(
      { blocks: [probeBlock] },
      translateHtmlDocuments,
      maxDocChars,
    );
    return extractRichTextFromBlocks(res.blocks, richText);
  }

  if (typeof richText === "string") {
    if (richText.length <= 1) {
      return richText;
    }
    // Guarantee strictly smaller slices even when heavy HTML escaping (e.g. `&` -> `&amp;`)
    // makes a shorter string exceed maxDocChars.
    const htmlLen = measureBlockHtml(probeBlock);
    const ratioBudget = Math.floor(
      (richText.length * maxDocChars * 0.8) / Math.max(1, htmlLen),
    );
    const safeCharBudget = Math.max(
      1,
      Math.min(Math.floor(richText.length / 2), ratioBudget),
    );
    const pieces = splitTextPreservingSeparators(richText, safeCharBudget);
    if (pieces.length <= 1) {
      return richText;
    }

    // Batch all pieces into a single translateHtmlDocuments call when every
    // piece fits individually under maxDocChars.
    const serializedPieces = pieces.map((piece) =>
      richMessageToTranslatableHtmlDocuments(
        { blocks: [{ type: "paragraph", text: piece.text }] },
        Number.MAX_SAFE_INTEGER,
      )
    );
    if (
      serializedPieces.every(
        (s) => (s.documents[0]?.html.length ?? 0) <= maxDocChars,
      )
    ) {
      const translatableIndices: number[] = [];
      const htmlBatch: string[] = [];
      for (let i = 0; i < serializedPieces.length; i++) {
        const doc = serializedPieces[i].documents[0];
        if (doc && doc.hasTranslatableText) {
          translatableIndices.push(i);
          htmlBatch.push(doc.html);
        }
      }

      const translatedMap = new Map<number, RichText>();
      if (htmlBatch.length > 0) {
        const translatedDocs = await translateHtmlDocuments(htmlBatch);
        if (translatedDocs.length !== htmlBatch.length) {
          throw new Error(
            `Translation document count mismatch: expected ${htmlBatch.length}, received ${translatedDocs.length}.`,
          );
        }
        for (let i = 0; i < translatableIndices.length; i++) {
          const pieceIdx = translatableIndices[i];
          const blocks = htmlToInputRichBlocks(
            translatedDocs[i],
            serializedPieces[pieceIdx].context,
            { normalizeTranslatedWhitespace: true },
          );
          translatedMap.set(
            pieceIdx,
            extractRichTextFromBlocks(blocks, pieces[pieceIdx].text),
          );
        }
      }

      const out: RichText[] = [];
      for (let i = 0; i < pieces.length; i++) {
        out.push(translatedMap.get(i) ?? pieces[i].text);
        if (pieces[i].separatorAfter) {
          out.push(pieces[i].separatorAfter);
        }
      }
      return normalizeRichTextNodes(out);
    }

    const out: RichText[] = [];
    for (const piece of pieces) {
      out.push(
        await translateRichTextChunked(
          piece.text,
          translateHtmlDocuments,
          maxDocChars,
        ),
      );
      if (piece.separatorAfter) {
        out.push(piece.separatorAfter);
      }
    }
    return normalizeRichTextNodes(out);
  }

  if (Array.isArray(richText)) {
    const groups: RichText[] = [];
    let current: RichText[] = [];
    for (const child of richText) {
      const candidate: RichText = current.length === 0
        ? child
        : [...current, child];
      if (
        current.length > 0 &&
        measureBlockHtml({ type: "paragraph", text: candidate }) > maxDocChars
      ) {
        groups.push(normalizeRichTextNodes(current));
        current = [child];
      } else {
        current.push(child);
      }
    }
    if (current.length > 0) {
      groups.push(normalizeRichTextNodes(current));
    }

    if (groups.length > 1) {
      const out: RichText[] = [];
      for (const group of groups) {
        out.push(
          await translateRichTextChunked(
            group,
            translateHtmlDocuments,
            maxDocChars,
          ),
        );
      }
      return normalizeRichTextNodes(out);
    }

    // Single child in array still exceeded maxDocChars; recurse into it.
    if (richText.length === 0) return "";
    return await translateRichTextChunked(
      richText[0],
      translateHtmlDocuments,
      maxDocChars,
    );
  }

  // Single oversized formatting wrapper: translate its inner `text` chunked.
  switch (richText.type) {
    case "custom_emoji":
    case "mathematical_expression":
    case "anchor":
    case "code":
    case "mention":
    case "hashtag":
    case "cashtag":
    case "bot_command":
    case "bank_card_number":
    case "ton_address":
      return richText;
    case "url":
      if (isBareLinkText(richText.text, richText.url)) {
        return richText;
      }
      return {
        ...richText,
        text: await translateRichTextChunked(
          richText.text,
          translateHtmlDocuments,
          maxDocChars,
        ),
      };
    case "email_address":
      if (
        richTextToPlainText(richText.text).trim().toLowerCase() ===
          richText.email_address.trim().toLowerCase()
      ) {
        return richText;
      }
      return {
        ...richText,
        text: await translateRichTextChunked(
          richText.text,
          translateHtmlDocuments,
          maxDocChars,
        ),
      };
    case "phone_number":
      if (
        richTextToPlainText(richText.text).trim() ===
          richText.phone_number.trim()
      ) {
        return richText;
      }
      return {
        ...richText,
        text: await translateRichTextChunked(
          richText.text,
          translateHtmlDocuments,
          maxDocChars,
        ),
      };
    case "button":
      return {
        type: "button",
        button: {
          ...richText.button,
          text: sanitizeButtonRichText(
            await translateRichTextChunked(
              richText.button.text,
              translateHtmlDocuments,
              maxDocChars,
            ),
          ),
        },
      };
    default:
      return {
        ...richText,
        text: await translateRichTextChunked(
          richText.text,
          translateHtmlDocuments,
          maxDocChars,
        ),
      };
  }
}

async function translateCaptionChunked(
  caption: RichBlockCaption | undefined,
  translateHtmlDocuments: (htmlDocs: string[]) => Promise<string[]>,
  maxDocChars: number,
): Promise<RichBlockCaption | undefined> {
  if (!caption) return undefined;
  const text = await translateRichTextChunked(
    caption.text,
    translateHtmlDocuments,
    maxDocChars,
  );
  const credit = caption.credit !== undefined
    ? await translateRichTextChunked(
      caption.credit,
      translateHtmlDocuments,
      maxDocChars,
    )
    : undefined;
  return {
    text,
    ...(credit !== undefined ? { credit } : {}),
  };
}

async function translateOversizedRichBlock(
  block: RichBlock,
  translateHtmlDocuments: (htmlDocs: string[]) => Promise<string[]>,
  maxDocChars: number,
): Promise<InputRichBlock> {
  switch (block.type) {
    case "paragraph":
      return {
        type: "paragraph",
        text: await translateRichTextChunked(
          block.text,
          translateHtmlDocuments,
          maxDocChars,
        ),
      };
    case "heading":
      return {
        type: "heading",
        size: block.size,
        text: await translateRichTextChunked(
          block.text,
          translateHtmlDocuments,
          maxDocChars,
        ),
      };
    case "footer":
      return {
        type: "footer",
        text: await translateRichTextChunked(
          block.text,
          translateHtmlDocuments,
          maxDocChars,
        ),
      };
    case "thinking":
      return {
        type: "thinking",
        text: await translateRichTextChunked(
          block.text,
          translateHtmlDocuments,
          maxDocChars,
        ),
      };
    case "pullquote": {
      const text = await translateRichTextChunked(
        block.text,
        translateHtmlDocuments,
        maxDocChars,
      );
      const credit = block.credit !== undefined
        ? await translateRichTextChunked(
          block.credit,
          translateHtmlDocuments,
          maxDocChars,
        )
        : undefined;
      return {
        type: "pullquote",
        text,
        ...(credit !== undefined ? { credit } : {}),
      };
    }
    case "blockquote":
    case "expandable_blockquote": {
      const inner = await translateRichMessageHtml(
        { blocks: block.blocks },
        translateHtmlDocuments,
        maxDocChars,
      );
      const credit = block.credit !== undefined
        ? await translateRichTextChunked(
          block.credit,
          translateHtmlDocuments,
          maxDocChars,
        )
        : undefined;
      return {
        type: block.type,
        blocks: inner.blocks ?? [],
        ...(credit !== undefined ? { credit } : {}),
      };
    }
    case "details": {
      const summary = await translateRichTextChunked(
        block.summary,
        translateHtmlDocuments,
        maxDocChars,
      );
      const inner = await translateRichMessageHtml(
        { blocks: block.blocks },
        translateHtmlDocuments,
        maxDocChars,
      );
      return {
        type: "details",
        summary,
        blocks: inner.blocks ?? [],
        ...(block.is_open ? { is_open: true } : {}),
      };
    }
    case "list": {
      const translatedItems: InputRichBlockListItem[] = [];
      let batch: RichBlockListItem[] = [];

      const flushBatch = async () => {
        if (batch.length === 0) return;
        if (
          batch.length === 1 &&
          measureBlockHtml({ type: "list", items: batch }) > maxDocChars
        ) {
          const item = batch[0];
          const inner = await translateRichMessageHtml(
            { blocks: item.blocks },
            translateHtmlDocuments,
            maxDocChars,
          );
          const itemBlocks = inner.blocks && inner.blocks.length > 0
            ? inner.blocks
            : item.blocks.map((child) => mapRichBlockToInput(child, (t) => t));
          if (itemBlocks.length > 0) {
            translatedItems.push({
              blocks: itemBlocks,
              ...(item.has_checkbox ? { has_checkbox: item.has_checkbox } : {}),
              ...(item.is_checked ? { is_checked: item.is_checked } : {}),
              ...(item.value !== undefined ? { value: item.value } : {}),
              ...(item.type !== undefined ? { type: item.type } : {}),
            });
          }
        } else {
          const res = await translateRichMessageHtml(
            { blocks: [{ type: "list", items: batch }] },
            translateHtmlDocuments,
            maxDocChars,
          );
          const listItems = (res.blocks ?? []).flatMap((b) =>
            b.type === "list" ? b.items : []
          );
          if (listItems.length > 0) {
            translatedItems.push(...listItems);
          } else {
            translatedItems.push(
              ...batch.map((item) =>
                toInputListItem(item, (child) =>
                  mapRichBlockToInput(child, (t) => t))
              ),
            );
          }
        }
        batch = [];
      };

      for (const item of block.items) {
        const candidate = [...batch, item];
        if (
          batch.length > 0 &&
          measureBlockHtml({ type: "list", items: candidate }) > maxDocChars
        ) {
          await flushBatch();
        }
        batch.push(item);
      }
      await flushBatch();
      return { type: "list", items: translatedItems };
    }
    case "table": {
      const translatedCaption = block.caption !== undefined
        ? await translateRichTextChunked(
          block.caption,
          translateHtmlDocuments,
          maxDocChars,
        )
        : undefined;
      const translatedRows: RichBlockTableCell[][] = [];
      let rowBatch: RichBlockTableCell[][] = [];

      const flushRows = async () => {
        if (rowBatch.length === 0) return;
        if (
          rowBatch.length === 1 &&
          measureBlockHtml({ type: "table", cells: rowBatch }) > maxDocChars
        ) {
          const translatedRow: RichBlockTableCell[] = [];
          for (const cell of rowBatch[0]) {
            translatedRow.push({
              ...cell,
              ...(cell.text !== undefined
                ? {
                  text: await translateRichTextChunked(
                    cell.text,
                    translateHtmlDocuments,
                    maxDocChars,
                  ),
                }
                : {}),
            });
          }
          translatedRows.push(translatedRow);
        } else {
          const res = await translateRichMessageHtml(
            { blocks: [{ type: "table", cells: rowBatch }] },
            translateHtmlDocuments,
            maxDocChars,
          );
          const tableRows = (res.blocks ?? []).flatMap((b) =>
            b.type === "table" ? b.cells : []
          );
          if (tableRows.length > 0) {
            translatedRows.push(...tableRows);
          } else {
            translatedRows.push(...rowBatch);
          }
        }
        rowBatch = [];
      };

      for (const row of block.cells) {
        const candidate = [...rowBatch, row];
        if (
          rowBatch.length > 0 &&
          measureBlockHtml({ type: "table", cells: candidate }) > maxDocChars
        ) {
          await flushRows();
        }
        rowBatch.push(row);
      }
      await flushRows();

      return {
        type: "table",
        cells: translatedRows,
        ...(block.is_bordered ? { is_bordered: true } : {}),
        ...(block.is_striped ? { is_striped: true } : {}),
        ...(block.is_compact ? { is_compact: true } : {}),
        ...(translatedCaption !== undefined
          ? { caption: translatedCaption }
          : {}),
      };
    }
    case "collage":
    case "slideshow": {
      const inner = await translateRichMessageHtml(
        { blocks: block.blocks },
        translateHtmlDocuments,
        maxDocChars,
      );
      const translatedChildren = (inner.blocks ?? []).filter(
        isGalleryMediaBlock,
      );
      const blocks = translatedChildren.length > 0
        ? translatedChildren
        : block.blocks.map((child) => mapRichBlockToInput(child, (t) => t));
      const caption = await translateCaptionChunked(
        block.caption,
        translateHtmlDocuments,
        maxDocChars,
      );
      return {
        type: block.type,
        blocks,
        ...(caption ? { caption } : {}),
      };
    }
    case "map":
    case "animation":
    case "audio":
    case "document":
    case "photo":
    case "video":
    case "voice_note": {
      const base = mapRichBlockToInput(block, (t) => t);
      if (
        block.caption !== undefined &&
        base.type !== "table" &&
        "caption" in base
      ) {
        const caption = await translateCaptionChunked(
          block.caption,
          translateHtmlDocuments,
          maxDocChars,
        );
        return { ...base, ...(caption ? { caption } : {}) };
      }
      return base;
    }
    case "buttons": {
      const buttons: RichMessageButton[] = [];
      for (const button of block.buttons) {
        buttons.push({
          ...button,
          text: sanitizeButtonRichText(
            await translateRichTextChunked(
              button.text,
              translateHtmlDocuments,
              maxDocChars,
            ),
          ),
        });
      }
      return {
        type: "buttons",
        buttons,
        ...(block.align !== undefined ? { align: block.align } : {}),
      };
    }
    default:
      return mapRichBlockToInput(block, (t) => t);
  }
}

/**
 * Translates a RichMessage as a single full-document HTML5 payload (splitting
 * at top-level block boundaries—and recursively inside any oversized single
 * block—only if the serialized HTML exceeds maxDocChars), so translation-llm
 * translates with complete cross-block article context.
 */
export async function translateRichMessageHtml(
  richMessage: RichMessage,
  translateHtmlDocuments: (htmlDocs: string[]) => Promise<string[]>,
  maxDocChars = MAX_TRANSLATE_HTML_DOC_CHARS,
): Promise<InputRichMessage> {
  const { documents, context } = richMessageToTranslatableHtmlDocuments(
    richMessage,
    maxDocChars,
  );

  const regularIndices: number[] = [];
  const htmlToTranslate: string[] = [];
  let hasOversized = false;

  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    if (!doc.hasTranslatableText) continue;
    if (doc.oversizedBlockIndex !== undefined) {
      hasOversized = true;
    } else {
      regularIndices.push(i);
      htmlToTranslate.push(doc.html);
    }
  }

  if (htmlToTranslate.length === 0 && !hasOversized) {
    return toInputRichMessage(richMessage);
  }

  const translatedByDoc = new Map<number, string>();
  if (htmlToTranslate.length > 0) {
    const translatedDocs = await translateHtmlDocuments(htmlToTranslate);
    if (translatedDocs.length !== htmlToTranslate.length) {
      throw new Error(
        `Translation document count mismatch: expected ${htmlToTranslate.length}, received ${translatedDocs.length}.`,
      );
    }
    for (let i = 0; i < regularIndices.length; i++) {
      translatedByDoc.set(regularIndices[i], translatedDocs[i]);
    }
  }

  const allBlocks: InputRichBlock[] = [];
  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    if (doc.oversizedBlockIndex !== undefined) {
      const translatedBlock = await translateOversizedRichBlock(
        richMessage.blocks[doc.oversizedBlockIndex],
        translateHtmlDocuments,
        maxDocChars,
      );
      allBlocks.push(translatedBlock);
    } else {
      const translatedHtml = translatedByDoc.get(i);
      const parsed = htmlToInputRichBlocks(
        translatedHtml ?? doc.html,
        context,
        {
          normalizeTranslatedWhitespace: true,
        },
      );
      if (parsed.length > 0) {
        allBlocks.push(...parsed);
      } else if (translatedHtml !== undefined) {
        allBlocks.push(...htmlToInputRichBlocks(doc.html, context));
      }
    }
  }

  if (allBlocks.length === 0 && richMessage.blocks.length > 0) {
    return toInputRichMessage(richMessage);
  }

  return {
    blocks: allBlocks,
    ...(richMessage.is_rtl !== undefined ? { is_rtl: richMessage.is_rtl } : {}),
  };
}

function isBareLinkText(text: RichText, target: string): boolean {
  return isBareUrlText(richTextToPlainText(text), target);
}

function mapProseStringsInRichText(
  richText: RichText,
  transform: (text: string, prevChar: string, nextChar: string) => string,
  state: { changed: boolean },
): RichText {
  const leaves: string[] = [];

  const collectLeaves = (node: RichText) => {
    if (typeof node === "string") {
      leaves.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) collectLeaves(child);
      return;
    }
    switch (node.type) {
      case "custom_emoji":
        leaves.push(node.alternative_text);
        return;
      case "mathematical_expression":
        leaves.push(node.expression);
        return;
      case "anchor":
        return;
      case "button":
        leaves.push("\uFFFC");
        return;
      default:
        collectLeaves(node.text);
    }
  };

  collectLeaves(richText);

  let leafIndex = 0;

  const getPrevChar = (idx: number): string => {
    for (let i = idx - 1; i >= 0; i--) {
      if (leaves[i].length > 0) return leaves[i][leaves[i].length - 1];
    }
    return "";
  };

  const getNextChar = (idx: number): string => {
    for (let i = idx + 1; i < leaves.length; i++) {
      if (leaves[i].length > 0) return leaves[i][0];
    }
    return "";
  };

  const rebuild = (node: RichText, skipProse: boolean): RichText => {
    if (typeof node === "string") {
      const idx = leafIndex++;
      if (skipProse) return node;
      const updated = transform(node, getPrevChar(idx), getNextChar(idx));
      if (updated !== node) {
        state.changed = true;
      }
      return updated;
    }
    if (Array.isArray(node)) {
      const rebuilt = node.map((child) => rebuild(child, skipProse));
      return normalizeRichTextNodes(rebuilt);
    }
    switch (node.type) {
      case "custom_emoji":
      case "mathematical_expression":
        leafIndex++;
        return node;
      case "anchor":
        return node;
      case "code":
      case "mention":
      case "hashtag":
      case "cashtag":
      case "bot_command":
      case "bank_card_number":
      case "ton_address":
        return {
          ...node,
          text: rebuild(node.text, true),
        };
      case "url": {
        const bare = isBareLinkText(node.text, node.url);
        const text = rebuild(node.text, skipProse || bare);
        return isEmptyRichText(text) ? "" : { ...node, text };
      }
      case "email_address": {
        const bare = richTextToPlainText(node.text).trim().toLowerCase() ===
          node.email_address.trim().toLowerCase();
        const text = rebuild(node.text, skipProse || bare);
        return isEmptyRichText(text) ? "" : { ...node, text };
      }
      case "phone_number": {
        const bare =
          richTextToPlainText(node.text).trim() === node.phone_number.trim();
        const text = rebuild(node.text, skipProse || bare);
        return isEmptyRichText(text) ? "" : { ...node, text };
      }
      case "button": {
        leafIndex++;
        const updatedBtnText = sanitizeButtonRichText(
          skipProse
            ? node.button.text
            : mapProseStringsInRichText(node.button.text, transform, state),
        );
        return {
          type: "button",
          button: {
            ...node.button,
            text: isEmptyRichText(updatedBtnText)
              ? sanitizeButtonRichText(node.button.text)
              : updatedBtnText,
          },
        };
      }
      default: {
        const text = rebuild(node.text, skipProse);
        return isEmptyRichText(text) ? "" : { ...node, text };
      }
    }
  };

  return rebuild(richText, false);
}

export function removeRepeatedSpacesInRichMessage(
  richMessage: RichMessage,
): { richMessage: InputRichMessage; changed: boolean } {
  const state = { changed: false };
  const blocks = richMessage.blocks.map((block) =>
    mapRichBlockToInput(block, (text) =>
      mapProseStringsInRichText(
        text,
        (segment, prevChar) => {
          let updated = segment
            .replace(/ {2,}/g, " ")
            .replace(/\n /g, "\n");
          if (
            (prevChar === " " || prevChar === "\n") && updated.startsWith(" ")
          ) {
            updated = updated.slice(1);
          }
          return updated;
        },
        state,
      )
    )
  );

  return {
    richMessage: {
      blocks,
      ...(richMessage.is_rtl !== undefined
        ? { is_rtl: richMessage.is_rtl }
        : {}),
    },
    changed: state.changed,
  };
}

export function fixPunctuationInRichMessage(
  richMessage: RichMessage,
  fixString: (text: string) => string,
): { richMessage: InputRichMessage; changed: boolean } {
  const state = { changed: false };
  const blocks = richMessage.blocks.map((block) =>
    mapRichBlockToInput(block, (text) =>
      mapProseStringsInRichText(
        text,
        (segment, prevChar, nextChar) =>
          applyTypographyWithContext(segment, prevChar, nextChar, fixString),
        state,
      )
    )
  );

  return {
    richMessage: {
      blocks,
      ...(richMessage.is_rtl !== undefined
        ? { is_rtl: richMessage.is_rtl }
        : {}),
    },
    changed: state.changed,
  };
}

/**
 * Splits plain text into one or more Telegram-valid InputRichMessages,
 * enforcing both the 32,768-character text limit and the 500-block limit.
 */
export function plainTextToRichMessages(
  text: string,
  maxChars = MAX_RICH_MESSAGE_CHARS,
  maxBlocks = MAX_RICH_MESSAGE_BLOCKS,
): InputRichMessage[] {
  const rawParagraphs = text
    .split(/(?:\r?\n){2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (rawParagraphs.length === 0) {
    return [{ blocks: [{ type: "paragraph", text: " " }] }];
  }

  // Split any individual paragraph exceeding maxChars safely.
  const paragraphs: string[] = [];
  for (const para of rawParagraphs) {
    if (para.length <= maxChars) {
      paragraphs.push(para);
    } else {
      for (const part of splitTextPreservingSeparators(para, maxChars)) {
        const trimmed = part.text.trim();
        if (trimmed) paragraphs.push(trimmed);
      }
    }
  }

  const messages: InputRichMessage[] = [];
  let currentBlocks: InputRichBlock[] = [];
  let currentChars = 0;

  for (const para of paragraphs) {
    const addedChars = para.length + (currentBlocks.length > 0 ? 1 : 0);
    if (
      currentBlocks.length > 0 &&
      (currentBlocks.length >= maxBlocks ||
        currentChars + addedChars > maxChars)
    ) {
      messages.push({ blocks: currentBlocks });
      currentBlocks = [];
      currentChars = 0;
    }
    currentBlocks.push({ type: "paragraph", text: para });
    currentChars += para.length + (currentBlocks.length > 1 ? 1 : 0);
  }

  if (currentBlocks.length > 0) {
    messages.push({ blocks: currentBlocks });
  }

  return messages;
}

export function plainTextToRichMessage(
  text: string,
  maxChars = MAX_RICH_MESSAGE_CHARS,
): InputRichMessage {
  const rawParagraphs = text
    .split(/(?:\r?\n){2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (rawParagraphs.length === 0) {
    return { blocks: [{ type: "paragraph", text: " " }] };
  }

  const collapsed = rawParagraphs.length <= MAX_RICH_MESSAGE_BLOCKS
    ? rawParagraphs
    : [
      ...rawParagraphs.slice(0, MAX_RICH_MESSAGE_BLOCKS - 1),
      rawParagraphs.slice(MAX_RICH_MESSAGE_BLOCKS - 1).join("\n\n"),
    ];

  const blocks: InputRichBlock[] = [];
  let usedChars = 0;

  for (const para of collapsed) {
    const sepCost = blocks.length > 0 ? 1 : 0;
    const remaining = maxChars - usedChars - sepCost;
    if (remaining <= 0) break;

    if (para.length <= remaining) {
      blocks.push({ type: "paragraph", text: para });
      usedChars += sepCost + para.length;
    } else {
      const clipped = truncateText(para, remaining);
      if (clipped.length > 0) {
        blocks.push({ type: "paragraph", text: clipped });
      }
      break;
    }
  }

  if (blocks.length === 0) {
    return { blocks: [{ type: "paragraph", text: " " }] };
  }

  return { blocks };
}
