import { parseFragment } from "parse5";
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
  InputRichMessageMedia,
  RichBlock,
  RichBlockCaption,
  RichBlockTableCell,
  RichMessage,
  RichMessageButton,
  RichText,
  RichTextTextMention,
} from "grammy/types.ts";
import {
  type ChildNode,
  type Element,
  escapeAttr,
  escapeBarePreHtml,
  escapeHtmlText,
  getAttr,
  getRawTextContent,
  hasAttr,
  isBareUrlText,
  isElement,
  isTextNode,
  parseFiniteNumber,
  parseSafeInt,
  sanitizeDateTimeFormat,
} from "./html_common.ts";

export type RichHtmlMode = "telegram" | "translate";

export interface HtmlToRichOptions {
  /**
   * When true, strips single spaces/tabs that translation APIs commonly inject
   * directly around `<br>` tags. Keep false for lossless Telegram HTML round-trips.
   */
  normalizeTranslatedWhitespace?: boolean;
}

export interface RichHtmlContext {
  media: Map<string, InputRichMessageMedia["media"]>;
  users: Map<number, RichTextTextMention["user"]>;
  buttons: Map<string, RichMessageButton>;
  preservedBlocks: Map<string, InputRichBlock>;
  preservedInline: Map<string, RichText>;
  referenceNames: Set<string>;
  isRtl?: boolean;
}

export interface SerializedRichHtml {
  html: string;
  context: RichHtmlContext;
}

export interface RichHtmlChunk {
  html: string;
  hasTranslatableText: boolean;
  oversizedBlockIndex?: number;
}

export function createRichHtmlContext(isRtl?: boolean): RichHtmlContext {
  return {
    media: new Map(),
    users: new Map(),
    buttons: new Map(),
    preservedBlocks: new Map(),
    preservedInline: new Map(),
    referenceNames: new Set(),
    ...(isRtl !== undefined ? { isRtl } : {}),
  };
}

function richTextToPlainTextInternal(richText: RichText): string {
  if (typeof richText === "string") return richText;
  if (Array.isArray(richText)) {
    return richText.map(richTextToPlainTextInternal).join("");
  }
  switch (richText.type) {
    case "custom_emoji":
      return richText.alternative_text;
    case "mathematical_expression":
      return richText.expression;
    case "anchor":
      return "";
    case "button":
      return richTextToPlainTextInternal(richText.button.text);
    default:
      return richTextToPlainTextInternal(richText.text);
  }
}

function isBareLinkText(text: RichText, target: string): boolean {
  return isBareUrlText(richTextToPlainTextInternal(text), target);
}

export function normalizeRichTextNodes(nodes: RichText[]): RichText {
  const flat: RichText[] = [];

  const push = (node: RichText) => {
    if (Array.isArray(node)) {
      for (const child of node) push(child);
      return;
    }
    if (typeof node === "string") {
      if (node.length === 0) return;
      if (flat.length > 0 && typeof flat[flat.length - 1] === "string") {
        flat[flat.length - 1] = (flat[flat.length - 1] as string) + node;
      } else {
        flat.push(node);
      }
      return;
    }
    flat.push(node);
  };

  for (const node of nodes) push(node);

  if (flat.length === 0) return "";
  if (flat.length === 1) return flat[0];
  return flat;
}

export function isEmptyRichText(node: RichText): boolean {
  if (typeof node === "string") return node.length === 0;
  if (Array.isArray(node)) return node.every(isEmptyRichText);
  if (
    node.type === "custom_emoji" ||
    node.type === "mathematical_expression" ||
    node.type === "anchor"
  ) {
    return false;
  }
  if (node.type === "button") {
    return isEmptyRichText(node.button.text);
  }
  return isEmptyRichText(node.text);
}

/**
 * Per Telegram Bot API, RichMessageButton.text may contain only plain text,
 * RichTextCustomEmoji, and RichTextDateTime entities.
 */
export function sanitizeButtonRichText(richText: RichText): RichText {
  const collect = (node: RichText, out: RichText[]) => {
    if (typeof node === "string") {
      out.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) collect(child, out);
      return;
    }
    if (node.type === "custom_emoji") {
      out.push(node);
      return;
    }
    if (node.type === "date_time") {
      out.push({
        type: "date_time",
        unix_time: node.unix_time,
        date_time_format: node.date_time_format,
        text: richTextToPlainTextInternal(node.text),
      });
      return;
    }
    if (node.type === "mathematical_expression") {
      out.push(node.expression);
      return;
    }
    if (node.type === "anchor") {
      return;
    }
    if (node.type === "button") {
      collect(node.button.text, out);
      return;
    }
    collect(node.text, out);
  };

  const nodes: RichText[] = [];
  collect(richText, nodes);
  return normalizeRichTextNodes(nodes);
}

interface SerializerState {
  mode: RichHtmlMode;
  ctx: RichHtmlContext;
  mediaCounter: number;
  buttonCounter: number;
  blockCounter: number;
  inlineCounter: number;
  hasTranslatableText: boolean;
}

function registerMedia(
  state: SerializerState,
  media: InputRichMessageMedia["media"],
): string {
  const id = `m${state.mediaCounter++}`;
  state.ctx.media.set(id, media);
  return id;
}

function registerButton(
  state: SerializerState,
  button: RichMessageButton,
): string {
  const id = `btn${state.buttonCounter++}`;
  state.ctx.buttons.set(id, button);
  return id;
}

function registerPreservedBlock(
  state: SerializerState,
  block: InputRichBlock,
): string {
  const id = `b${state.blockCounter++}`;
  state.ctx.preservedBlocks.set(id, block);
  return id;
}

function registerPreservedInline(
  state: SerializerState,
  node: RichText,
): string {
  const id = `i${state.inlineCounter++}`;
  state.ctx.preservedInline.set(id, node);
  return id;
}

function serializeButtonAttrs(
  button: RichMessageButton,
  btnId: string | undefined,
): string {
  const attrs: string[] = [];
  if (btnId) {
    attrs.push(`data-tg-btn="${escapeAttr(btnId)}"`);
  }
  if (button.style) {
    attrs.push(`style="${escapeAttr(button.style)}"`);
  }
  if ("url" in button) {
    attrs.push(`type="url"`, `url="${escapeAttr(button.url)}"`);
  } else if ("callback_data" in button) {
    attrs.push(
      `type="callback_data"`,
      `data="${escapeAttr(button.callback_data)}"`,
    );
  } else if ("web_app" in button) {
    attrs.push(`type="web_app"`, `url="${escapeAttr(button.web_app.url)}"`);
  } else if ("login_url" in button) {
    attrs.push(
      `type="login_url"`,
      `url="${escapeAttr(button.login_url.url)}"`,
    );
    if (button.login_url.forward_text) {
      attrs.push(
        `forward-text="${escapeAttr(button.login_url.forward_text)}"`,
      );
    }
    if (button.login_url.request_write_access) {
      attrs.push(`request-write-access`);
    }
  } else if ("switch_inline_query" in button) {
    attrs.push(
      `type="switch_inline_query"`,
      `query="${escapeAttr(button.switch_inline_query)}"`,
    );
  } else if ("switch_inline_query_current_chat" in button) {
    attrs.push(
      `type="switch_inline_query_current_chat"`,
      `query="${escapeAttr(button.switch_inline_query_current_chat)}"`,
    );
  } else if ("switch_inline_query_chosen_chat" in button) {
    attrs.push(`type="switch_inline_query_chosen_chat"`);
    const cfg = button.switch_inline_query_chosen_chat;
    if (cfg.query !== undefined) attrs.push(`query="${escapeAttr(cfg.query)}"`);
    if (cfg.allow_user_chats) attrs.push(`allow-user-chats`);
    if (cfg.allow_bot_chats) attrs.push(`allow-bot-chats`);
    if (cfg.allow_group_chats) attrs.push(`allow-group-chats`);
    if (cfg.allow_channel_chats) attrs.push(`allow-channel-chats`);
  } else if ("copy_text" in button) {
    attrs.push(
      `type="copy_text"`,
      `text="${escapeAttr(button.copy_text.text)}"`,
    );
  } else if ("disabled" in button) {
    attrs.push(`type="disabled"`);
  }
  return attrs.length > 0 ? " " + attrs.join(" ") : "";
}

function serializeRichText(node: RichText, state: SerializerState): string {
  if (typeof node === "string") {
    if (/\S/.test(node)) {
      state.hasTranslatableText = true;
    }
    return escapeHtmlText(node);
  }
  if (Array.isArray(node)) {
    return node.map((child) => serializeRichText(child, state)).join("");
  }

  const translateMode = state.mode === "translate";

  switch (node.type) {
    case "bold":
      return `<b>${serializeRichText(node.text, state)}</b>`;
    case "italic":
      return `<i>${serializeRichText(node.text, state)}</i>`;
    case "underline":
      return `<u>${serializeRichText(node.text, state)}</u>`;
    case "strikethrough":
      return `<s>${serializeRichText(node.text, state)}</s>`;
    case "spoiler":
      return `<tg-spoiler>${serializeRichText(node.text, state)}</tg-spoiler>`;
    case "subscript":
      return `<sub>${serializeRichText(node.text, state)}</sub>`;
    case "superscript":
      return `<sup>${serializeRichText(node.text, state)}</sup>`;
    case "marked":
      return `<mark>${serializeRichText(node.text, state)}</mark>`;
    case "code": {
      const plain = richTextToPlainTextInternal(node.text);
      if (translateMode) {
        const id = registerPreservedInline(state, node);
        return `<code translate="no" class="notranslate" data-tg-inline="${id}">${
          escapeHtmlText(plain)
        }</code>`;
      }
      return `<code>${escapeHtmlText(plain)}</code>`;
    }
    case "custom_emoji": {
      if (translateMode) {
        const id = registerPreservedInline(state, node);
        return `<tg-emoji emoji-id="${
          escapeAttr(node.custom_emoji_id)
        }" translate="no" class="notranslate" data-tg-inline="${id}">${
          escapeHtmlText(node.alternative_text)
        }</tg-emoji>`;
      }
      return `<tg-emoji emoji-id="${escapeAttr(node.custom_emoji_id)}">${
        escapeHtmlText(node.alternative_text)
      }</tg-emoji>`;
    }
    case "mathematical_expression": {
      if (translateMode) {
        const id = registerPreservedInline(state, node);
        return `<tg-math translate="no" class="notranslate" data-tg-inline="${id}">${
          escapeHtmlText(node.expression)
        }</tg-math>`;
      }
      return `<tg-math>${escapeHtmlText(node.expression)}</tg-math>`;
    }
    case "date_time":
      return `<tg-time unix="${node.unix_time}" format="${
        escapeAttr(sanitizeDateTimeFormat(node.date_time_format))
      }">${serializeRichText(node.text, state)}</tg-time>`;
    case "url": {
      if (translateMode && isBareLinkText(node.text, node.url)) {
        const id = registerPreservedInline(state, node);
        return `<a href="${
          escapeAttr(node.url)
        }" translate="no" class="notranslate" data-tg-inline="${id}">${
          escapeHtmlText(richTextToPlainTextInternal(node.text))
        }</a>`;
      }
      return `<a href="${escapeAttr(node.url)}">${
        serializeRichText(node.text, state)
      }</a>`;
    }
    case "email_address": {
      const plain = richTextToPlainTextInternal(node.text);
      if (
        translateMode &&
        plain.trim().toLowerCase() === node.email_address.trim().toLowerCase()
      ) {
        const id = registerPreservedInline(state, node);
        return `<a href="mailto:${
          escapeAttr(node.email_address)
        }" translate="no" class="notranslate" data-tg-inline="${id}">${
          escapeHtmlText(plain)
        }</a>`;
      }
      return `<a href="mailto:${escapeAttr(node.email_address)}">${
        serializeRichText(node.text, state)
      }</a>`;
    }
    case "phone_number": {
      const plain = richTextToPlainTextInternal(node.text);
      if (translateMode && plain.trim() === node.phone_number.trim()) {
        const id = registerPreservedInline(state, node);
        return `<a href="tel:${
          escapeAttr(node.phone_number)
        }" translate="no" class="notranslate" data-tg-inline="${id}">${
          escapeHtmlText(plain)
        }</a>`;
      }
      return `<a href="tel:${escapeAttr(node.phone_number)}">${
        serializeRichText(node.text, state)
      }</a>`;
    }
    case "text_mention": {
      state.ctx.users.set(node.user.id, node.user);
      return `<a href="tg://user?id=${node.user.id}">${
        serializeRichText(node.text, state)
      }</a>`;
    }
    case "anchor": {
      if (translateMode) {
        const id = registerPreservedInline(state, node);
        return `<a name="${
          escapeAttr(node.name)
        }" translate="no" class="notranslate" data-tg-inline="${id}"></a>`;
      }
      return `<a name="${escapeAttr(node.name)}"></a>`;
    }
    case "anchor_link":
      return `<a href="#${
        escapeAttr(node.anchor_name)
      }" data-tg-link="anchor">${serializeRichText(node.text, state)}</a>`;
    case "reference":
      state.ctx.referenceNames.add(node.name);
      return `<tg-reference name="${escapeAttr(node.name)}">${
        serializeRichText(node.text, state)
      }</tg-reference>`;
    case "reference_link":
      state.ctx.referenceNames.add(node.reference_name);
      return `<a href="#${
        escapeAttr(node.reference_name)
      }" data-tg-link="reference">${serializeRichText(node.text, state)}</a>`;
    case "button": {
      const btnId = registerButton(state, node.button);
      return `<tg-button${serializeButtonAttrs(node.button, btnId)}>${
        serializeRichText(node.button.text, state)
      }</tg-button>`;
    }
    case "mention":
    case "hashtag":
    case "cashtag":
    case "bot_command":
    case "bank_card_number":
    case "ton_address": {
      const plain = richTextToPlainTextInternal(node.text);
      if (translateMode) {
        const id = registerPreservedInline(state, node);
        return `<span translate="no" class="notranslate" data-tg-inline="${id}">${
          escapeHtmlText(plain)
        }</span>`;
      }
      return escapeHtmlText(plain);
    }
  }
}

function serializeCaption(
  caption: RichBlockCaption | undefined,
  state: SerializerState,
): string {
  if (!caption) return "";
  const textHtml = serializeRichText(caption.text, state);
  const creditHtml = caption.credit !== undefined
    ? `<cite>${serializeRichText(caption.credit, state)}</cite>`
    : "";
  return `<figcaption>${textHtml}${creditHtml}</figcaption>`;
}

function wrapWithOptionalFigure(
  mediaHtml: string,
  caption: RichBlockCaption | undefined,
  state: SerializerState,
  figureFallbackAttr?: string,
): string {
  if (!caption) return mediaHtml;
  const attr = state.mode === "translate" && figureFallbackAttr
    ? ` ${figureFallbackAttr}`
    : "";
  return `<figure${attr}>${mediaHtml}${serializeCaption(caption, state)}</figure>`;
}

function serializeBlock(block: RichBlock, state: SerializerState): string {
  const translateMode = state.mode === "translate";

  switch (block.type) {
    case "paragraph":
      return `<p>${serializeRichText(block.text, state)}</p>`;
    case "heading":
      return `<h${block.size}>${
        serializeRichText(block.text, state)
      }</h${block.size}>`;
    case "pre": {
      if (translateMode) {
        const id = registerPreservedBlock(state, {
          type: "pre",
          text: block.text,
          ...(block.language !== undefined ? { language: block.language } : {}),
        });
        return `<pre id="tg-block-${id}" translate="no" class="notranslate" data-tg-block="${id}">code</pre>`;
      }
      const raw = richTextToPlainTextInternal(block.text);
      if (block.language) {
        return `<pre><code class="language-${
          escapeAttr(block.language)
        }">${escapeHtmlText(raw, true)}</code></pre>`;
      }
      return `<pre>${escapeBarePreHtml(raw)}</pre>`;
    }
    case "footer":
      return `<footer>${serializeRichText(block.text, state)}</footer>`;
    case "divider": {
      if (translateMode) {
        const id = registerPreservedBlock(state, { type: "divider" });
        return `<hr id="tg-block-${id}" translate="no" class="notranslate" data-tg-block="${id}">`;
      }
      return `<hr>`;
    }
    case "mathematical_expression": {
      if (translateMode) {
        const id = registerPreservedBlock(state, {
          type: "mathematical_expression",
          expression: block.expression,
        });
        return `<tg-math-block id="tg-block-${id}" translate="no" class="notranslate" data-tg-block="${id}">formula</tg-math-block>`;
      }
      return `<tg-math-block>${
        escapeHtmlText(block.expression, true)
      }</tg-math-block>`;
    }
    case "anchor": {
      if (translateMode) {
        const id = registerPreservedBlock(state, {
          type: "anchor",
          name: block.name,
        });
        return `<a id="tg-block-${id}" name="${
          escapeAttr(block.name)
        }" translate="no" class="notranslate" data-tg-block="${id}" data-tg-block-anchor="true"></a>`;
      }
      return `<a name="${
        escapeAttr(block.name)
      }" data-tg-block-anchor="true"></a>`;
    }
    case "list": {
      const isOrdered = block.items.some(
        (item) => item.value !== undefined || item.type !== undefined,
      );
      const tag = isOrdered ? "ol" : "ul";
      const itemsHtml = block.items
        .map((item) => {
          const attrs: string[] = [];
          if (item.value !== undefined) {
            attrs.push(`value="${item.value}"`);
          }
          if (item.type !== undefined) {
            attrs.push(`type="${escapeAttr(item.type)}"`);
          }
          if (
            isOrdered &&
            item.value === undefined &&
            item.type === undefined
          ) {
            attrs.push(`data-tg-unordered="true"`);
          }
          const attrStr = attrs.length > 0 ? " " + attrs.join(" ") : "";
          const checkbox = item.has_checkbox
            ? `<input type="checkbox"${item.is_checked ? " checked" : ""}>`
            : "";
          const childrenHtml = item.blocks
            .map((child) => serializeBlock(child, state))
            .join("");
          return `<li${attrStr}>${checkbox}${childrenHtml}</li>`;
        })
        .join("");
      return `<${tag}>${itemsHtml}</${tag}>`;
    }
    case "blockquote":
    case "expandable_blockquote": {
      const attr = block.type === "expandable_blockquote" ? " expandable" : "";
      const childrenHtml = block.blocks
        .map((child) => serializeBlock(child, state))
        .join("");
      const creditHtml = block.credit !== undefined
        ? `<cite>${serializeRichText(block.credit, state)}</cite>`
        : "";
      return `<blockquote${attr}>${childrenHtml}${creditHtml}</blockquote>`;
    }
    case "pullquote": {
      const textHtml = serializeRichText(block.text, state);
      const creditHtml = block.credit !== undefined
        ? `<cite>${serializeRichText(block.credit, state)}</cite>`
        : "";
      return `<aside>${textHtml}${creditHtml}</aside>`;
    }
    case "collage":
    case "slideshow": {
      const tag = block.type === "collage" ? "tg-collage" : "tg-slideshow";
      const childrenHtml = block.blocks
        .map((child) => serializeBlock(child, state))
        .join("");
      const captionHtml = serializeCaption(block.caption, state);
      return `<${tag}>${childrenHtml}${captionHtml}</${tag}>`;
    }
    case "table": {
      const attrs: string[] = [];
      if (block.is_bordered) attrs.push("bordered");
      if (block.is_striped) attrs.push("striped");
      if (block.is_compact) attrs.push("compact");
      const attrStr = attrs.length > 0 ? " " + attrs.join(" ") : "";
      const captionHtml = block.caption !== undefined
        ? `<caption>${serializeRichText(block.caption, state)}</caption>`
        : "";
      const rowsHtml = block.cells
        .map((row) => {
          const cellsHtml = row
            .map((cell) => {
              const cellTag = cell.is_header ? "th" : "td";
              const cellAttrs: string[] = [];
              if (cell.colspan !== undefined && cell.colspan > 1) {
                cellAttrs.push(`colspan="${cell.colspan}"`);
              }
              if (cell.rowspan !== undefined && cell.rowspan > 1) {
                cellAttrs.push(`rowspan="${cell.rowspan}"`);
              }
              cellAttrs.push(`align="${escapeAttr(cell.align)}"`);
              cellAttrs.push(`valign="${escapeAttr(cell.valign)}"`);
              if (cell.text === undefined) {
                cellAttrs.push(`data-tg-empty="true"`);
              }
              const content = cell.text !== undefined
                ? serializeRichText(cell.text, state)
                : "";
              return `<${cellTag} ${cellAttrs.join(" ")}>${content}</${cellTag}>`;
            })
            .join("");
          return `<tr>${cellsHtml}</tr>`;
        })
        .join("");
      return `<table${attrStr}>${captionHtml}<tbody>${rowsHtml}</tbody></table>`;
    }
    case "details": {
      const openAttr = block.is_open ? " open" : "";
      const summaryHtml = `<summary>${
        serializeRichText(block.summary, state)
      }</summary>`;
      const childrenHtml = block.blocks
        .map((child) => serializeBlock(child, state))
        .join("");
      return `<details${openAttr}>${summaryHtml}${childrenHtml}</details>`;
    }
    case "map": {
      const attrs = [
        `lat="${block.location.latitude}"`,
        `long="${block.location.longitude}"`,
        `zoom="${block.zoom}"`,
        `width="${block.width}"`,
        `height="${block.height}"`,
      ];
      let mapFallbackAttr: string | undefined;
      if (translateMode) {
        const id = registerPreservedBlock(state, {
          type: "map",
          location: block.location,
          zoom: block.zoom,
          width: block.width,
          height: block.height,
        });
        attrs.push(`translate="no"`, `class="notranslate"`);
        if (block.caption) {
          attrs.push(`data-tg-map-block="${id}"`);
          mapFallbackAttr = `id="tg-map-${id}" data-tg-map-block="${id}"`;
        } else {
          attrs.push(`id="tg-block-${id}"`, `data-tg-block="${id}"`);
        }
      }
      const mapHtml = `<tg-map ${attrs.join(" ")}>${
        translateMode ? "map" : ""
      }</tg-map>`;
      return wrapWithOptionalFigure(
        mapHtml,
        block.caption,
        state,
        mapFallbackAttr,
      );
    }
    case "photo": {
      const largest = block.photo[block.photo.length - 1];
      const photo: InputMediaPhoto = {
        type: "photo",
        media: largest.file_id,
        ...(block.has_spoiler ? { has_spoiler: true } : {}),
      };
      const id = registerMedia(state, photo);
      const attrs = [`src="tg://photo?id=${id}"`];
      if (block.has_spoiler) attrs.push("tg-spoiler");
      if (translateMode) attrs.push(`translate="no"`, `class="notranslate"`);
      const imgHtml = `<img ${attrs.join(" ")}>`;
      if (translateMode && !block.caption) {
        const blockId = registerPreservedBlock(state, {
          type: "photo",
          photo,
        });
        return `<figure id="tg-block-${blockId}" translate="no" class="notranslate" data-tg-block="${blockId}">${imgHtml}photo</figure>`;
      }
      return wrapWithOptionalFigure(
        imgHtml,
        block.caption,
        state,
        `id="tg-media-${id}" data-tg-media="${id}"`,
      );
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
      const id = registerMedia(state, video);
      const attrs = [`src="tg://video?id=${id}"`];
      if (block.has_spoiler) attrs.push("tg-spoiler");
      if (translateMode) {
        attrs.push(`translate="no"`, `class="notranslate"`);
        if (!block.caption) {
          const blockId = registerPreservedBlock(state, {
            type: "video",
            video,
          });
          attrs.push(`id="tg-block-${blockId}"`, `data-tg-block="${blockId}"`);
        }
      }
      const videoHtml = `<video ${attrs.join(" ")}>${
        translateMode ? "video" : ""
      }</video>`;
      return wrapWithOptionalFigure(
        videoHtml,
        block.caption,
        state,
        `id="tg-media-${id}" data-tg-media="${id}"`,
      );
    }
    case "animation": {
      const animation: InputMediaAnimation = {
        type: "animation",
        media: block.animation.file_id,
        width: block.animation.width,
        height: block.animation.height,
        duration: block.animation.duration,
        ...(block.has_spoiler ? { has_spoiler: true } : {}),
      };
      const id = registerMedia(state, animation);
      const attrs = [
        `src="tg://video?id=${id}"`,
        `data-tg-media-kind="animation"`,
      ];
      if (block.has_spoiler) attrs.push("tg-spoiler");
      if (translateMode) {
        attrs.push(`translate="no"`, `class="notranslate"`);
        if (!block.caption) {
          const blockId = registerPreservedBlock(state, {
            type: "animation",
            animation,
          });
          attrs.push(`id="tg-block-${blockId}"`, `data-tg-block="${blockId}"`);
        }
      }
      const animHtml = `<video ${attrs.join(" ")}>${
        translateMode ? "animation" : ""
      }</video>`;
      return wrapWithOptionalFigure(
        animHtml,
        block.caption,
        state,
        `id="tg-media-${id}" data-tg-media="${id}"`,
      );
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
      const id = registerMedia(state, audio);
      const attrs = [`src="tg://audio?id=${id}"`];
      if (translateMode) {
        attrs.push(`translate="no"`, `class="notranslate"`);
        if (!block.caption) {
          const blockId = registerPreservedBlock(state, {
            type: "audio",
            audio,
          });
          attrs.push(`id="tg-block-${blockId}"`, `data-tg-block="${blockId}"`);
        }
      }
      const audioHtml = `<audio ${attrs.join(" ")}>${
        translateMode ? "audio" : ""
      }</audio>`;
      return wrapWithOptionalFigure(
        audioHtml,
        block.caption,
        state,
        `id="tg-media-${id}" data-tg-media="${id}"`,
      );
    }
    case "voice_note": {
      const voiceNote: InputMediaVoiceNote = {
        type: "voice_note",
        media: block.voice_note.file_id,
        duration: block.voice_note.duration,
      };
      const id = registerMedia(state, voiceNote);
      const attrs = [
        `src="tg://audio?id=${id}"`,
        `data-tg-media-kind="voice_note"`,
      ];
      if (translateMode) {
        attrs.push(`translate="no"`, `class="notranslate"`);
        if (!block.caption) {
          const blockId = registerPreservedBlock(state, {
            type: "voice_note",
            voice_note: voiceNote,
          });
          attrs.push(`id="tg-block-${blockId}"`, `data-tg-block="${blockId}"`);
        }
      }
      const voiceHtml = `<audio ${attrs.join(" ")}>${
        translateMode ? "voice" : ""
      }</audio>`;
      return wrapWithOptionalFigure(
        voiceHtml,
        block.caption,
        state,
        `id="tg-media-${id}" data-tg-media="${id}"`,
      );
    }
    case "document": {
      const document: InputMediaDocument = {
        type: "document",
        media: block.document.file_id,
      };
      const id = registerMedia(state, document);
      const attrs = [`src="tg://document?id=${id}"`];
      if (translateMode) {
        attrs.push(`translate="no"`, `class="notranslate"`);
        if (!block.caption) {
          const blockId = registerPreservedBlock(state, {
            type: "document",
            document,
          });
          attrs.push(`id="tg-block-${blockId}"`, `data-tg-block="${blockId}"`);
        }
      }
      const docHtml = `<tg-document ${attrs.join(" ")}>${
        translateMode ? "file" : ""
      }</tg-document>`;
      return wrapWithOptionalFigure(
        docHtml,
        block.caption,
        state,
        `id="tg-media-${id}" data-tg-media="${id}"`,
      );
    }
    case "buttons": {
      const alignAttr = block.align ? ` align="${escapeAttr(block.align)}"` : "";
      const buttonsHtml = block.buttons
        .map((button) => {
          const btnId = registerButton(state, button);
          return `<tg-button${serializeButtonAttrs(button, btnId)}>${
            serializeRichText(button.text, state)
          }</tg-button>`;
        })
        .join("");
      return `<tg-button-row${alignAttr}>${buttonsHtml}</tg-button-row>`;
    }
    case "thinking":
      return `<tg-thinking>${
        serializeRichText(block.text, state)
      }</tg-thinking>`;
  }
}

export function richMessageToHtml(
  richMessage: RichMessage,
  options?: { mode?: RichHtmlMode },
): SerializedRichHtml {
  const ctx = createRichHtmlContext(richMessage.is_rtl);
  const state: SerializerState = {
    mode: options?.mode ?? "telegram",
    ctx,
    mediaCounter: 0,
    buttonCounter: 0,
    blockCounter: 0,
    inlineCounter: 0,
    hasTranslatableText: false,
  };

  const html = richMessage.blocks
    .map((block) => serializeBlock(block, state))
    .join("\n");

  return { html, context: ctx };
}

/**
 * Serializes a RichMessage into the fewest possible full-HTML document chunks
 * (almost always 1 single document) so an LLM translator sees the entire
 * article's full context while staying safely below Cloud Translation's
 * 30,000-codepoint per-request limit.
 */
export function richMessageToTranslatableHtmlDocuments(
  richMessage: RichMessage,
  maxDocChars = 24_000,
): { documents: RichHtmlChunk[]; context: RichHtmlContext } {
  const ctx = createRichHtmlContext(richMessage.is_rtl);
  const state: SerializerState = {
    mode: "translate",
    ctx,
    mediaCounter: 0,
    buttonCounter: 0,
    blockCounter: 0,
    inlineCounter: 0,
    hasTranslatableText: false,
  };

  const blockEntries: {
    blockIndex: number;
    html: string;
    hasTranslatableText: boolean;
  }[] = [];
  for (let i = 0; i < richMessage.blocks.length; i++) {
    const block = richMessage.blocks[i];
    state.hasTranslatableText = false;
    const html = serializeBlock(block, state);
    blockEntries.push({
      blockIndex: i,
      html,
      hasTranslatableText: state.hasTranslatableText,
    });
  }

  const documents: RichHtmlChunk[] = [];
  let currentParts: string[] = [];
  let currentChars = 0;
  let currentHasText = false;

  const flushCurrent = () => {
    if (currentParts.length === 0) return;
    documents.push({
      html: currentParts.join("\n"),
      hasTranslatableText: currentHasText,
    });
    currentParts = [];
    currentChars = 0;
    currentHasText = false;
  };

  for (const entry of blockEntries) {
    if (entry.html.length > maxDocChars && entry.hasTranslatableText) {
      flushCurrent();
      documents.push({
        html: entry.html,
        hasTranslatableText: true,
        oversizedBlockIndex: entry.blockIndex,
      });
      continue;
    }

    const addedLen = entry.html.length + (currentParts.length > 0 ? 1 : 0);
    if (currentParts.length > 0 && currentChars + addedLen > maxDocChars) {
      flushCurrent();
    }

    currentParts.push(entry.html);
    currentChars += entry.html.length + (currentParts.length > 1 ? 1 : 0);
    if (entry.hasTranslatableText) {
      currentHasText = true;
    }
  }

  flushCurrent();

  return { documents, context: ctx };
}

// ============================================================================
// Deserializer (WHATWG HTML5 DOM via parse5 -> InputRichMessage)
// ============================================================================

function collectReferenceNames(nodes: ChildNode[], out: Set<string>): void {
  for (const node of nodes) {
    if (!isElement(node)) continue;
    if (node.tagName.toLowerCase() === "tg-reference") {
      const name = getAttr(node, "name");
      if (name) out.add(name);
    }
    collectReferenceNames(node.childNodes, out);
  }
}

function parseButtonFromElement(
  el: Element,
  ctx: RichHtmlContext,
  refNames: Set<string>,
  normalizeWs: boolean,
): RichMessageButton | undefined {
  const parsedText = sanitizeButtonRichText(
    parseInlineNodes(el.childNodes, ctx, refNames, normalizeWs),
  );
  const btnId = getAttr(el, "data-tg-btn");
  const saved = btnId ? ctx.buttons.get(btnId) : undefined;
  if (saved) {
    const text = isEmptyRichText(parsedText)
      ? sanitizeButtonRichText(saved.text)
      : parsedText;
    return { ...saved, text };
  }
  if (isEmptyRichText(parsedText)) return undefined;
  const text = parsedText;

  const styleRaw = getAttr(el, "style");
  const style: "danger" | "success" | "primary" | "link" | undefined =
    styleRaw === "danger" || styleRaw === "success" ||
      styleRaw === "primary" || styleRaw === "link"
      ? styleRaw
      : undefined;
  const type = getAttr(el, "type");
  const base = style ? { text, style } : { text };

  switch (type) {
    case "url": {
      const url = getAttr(el, "url");
      if (!url) return undefined;
      return { ...base, url };
    }
    case "callback_data": {
      const callback_data = getAttr(el, "data");
      if (!callback_data) return undefined;
      return { ...base, callback_data };
    }
    case "web_app": {
      const url = getAttr(el, "url");
      if (!url) return undefined;
      return { ...base, web_app: { url } };
    }
    case "login_url": {
      const url = getAttr(el, "url");
      if (!url) return undefined;
      const forward_text = getAttr(el, "forward-text");
      const request_write_access = hasAttr(el, "request-write-access");
      return {
        ...base,
        login_url: {
          url,
          ...(forward_text ? { forward_text } : {}),
          ...(request_write_access ? { request_write_access: true } : {}),
        },
      };
    }
    case "switch_inline_query":
      return { ...base, switch_inline_query: getAttr(el, "query") ?? "" };
    case "switch_inline_query_current_chat":
      return {
        ...base,
        switch_inline_query_current_chat: getAttr(el, "query") ?? "",
      };
    case "switch_inline_query_chosen_chat":
      return {
        ...base,
        switch_inline_query_chosen_chat: {
          ...(getAttr(el, "query") !== undefined
            ? { query: getAttr(el, "query") }
            : {}),
          ...(hasAttr(el, "allow-user-chats")
            ? { allow_user_chats: true }
            : {}),
          ...(hasAttr(el, "allow-bot-chats") ? { allow_bot_chats: true } : {}),
          ...(hasAttr(el, "allow-group-chats")
            ? { allow_group_chats: true }
            : {}),
          ...(hasAttr(el, "allow-channel-chats")
            ? { allow_channel_chats: true }
            : {}),
        },
      };
    case "copy_text": {
      const copyText = getAttr(el, "text");
      if (copyText === undefined) return undefined;
      return { ...base, copy_text: { text: copyText } };
    }
    case "disabled":
      return { ...base, disabled: {} };
    default:
      return undefined;
  }
}

function parseInlineNodes(
  nodes: ChildNode[],
  ctx: RichHtmlContext,
  refNames: Set<string>,
  normalizeWs: boolean,
): RichText {
  const out: RichText[] = [];
  let pendingInlineBreak = false;

  const endsWithNewline = (): boolean => {
    for (let i = out.length - 1; i >= 0; i--) {
      const item = out[i];
      if (typeof item === "string") {
        if (item.length > 0) return item.endsWith("\n");
      } else {
        return false;
      }
    }
    return false;
  };

  const flushInlineBreak = (upcoming?: RichText) => {
    if (!pendingInlineBreak) return;
    pendingInlineBreak = false;
    if (
      out.length > 0 &&
      !endsWithNewline() &&
      !(typeof upcoming === "string" && upcoming.startsWith("\n"))
    ) {
      out.push("\n");
    }
  };

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (isTextNode(node)) {
      let val = node.value;
      if (normalizeWs) {
        // Strip single spurious spaces Google Translate may insert directly next to <br>.
        const prev = nodes[i - 1];
        const next = nodes[i + 1];
        if (prev && isElement(prev) && prev.tagName.toLowerCase() === "br") {
          val = val.replace(/^[ \t]/, "");
        }
        if (next && isElement(next) && next.tagName.toLowerCase() === "br") {
          val = val.replace(/[ \t]+$/, "");
        }
      }
      if (val.length > 0) {
        flushInlineBreak(val);
        out.push(val);
      }
      continue;
    }

    if (!isElement(node)) continue;

    const inlineId = getAttr(node, "data-tg-inline");
    if (inlineId && ctx.preservedInline.has(inlineId)) {
      const preserved = ctx.preservedInline.get(inlineId)!;
      flushInlineBreak(preserved);
      out.push(preserved);
      continue;
    }

    const tag = node.tagName.toLowerCase();

    if (tag === "br") {
      pendingInlineBreak = false;
      out.push("\n");
      continue;
    }

    if (tag === "p" || tag === "div") {
      pendingInlineBreak = false;
      const inner = parseInlineNodes(
        node.childNodes,
        ctx,
        refNames,
        normalizeWs,
      );
      if (!isEmptyRichText(inner)) {
        if (out.length > 0 && !endsWithNewline()) {
          out.push("\n");
        }
        out.push(inner);
        pendingInlineBreak = true;
      }
      continue;
    }

    if (tag === "tg-emoji") {
      const emojiId = getAttr(node, "emoji-id");
      const alt = getRawTextContent(node);
      if (emojiId) {
        flushInlineBreak();
        out.push({
          type: "custom_emoji",
          custom_emoji_id: emojiId,
          alternative_text: alt,
        });
      } else if (alt) {
        flushInlineBreak(alt);
        out.push(alt);
      }
      continue;
    }

    if (tag === "img") {
      const src = getAttr(node, "src") ?? "";
      const emojiMatch = src.match(/^tg:\/\/emoji\?id=(.+)$/);
      if (emojiMatch) {
        flushInlineBreak();
        out.push({
          type: "custom_emoji",
          custom_emoji_id: emojiMatch[1],
          alternative_text: getAttr(node, "alt") ?? "",
        });
      }
      continue;
    }

    if (tag === "tg-math") {
      const expression = getRawTextContent(node);
      if (expression) {
        flushInlineBreak();
        out.push({ type: "mathematical_expression", expression });
      }
      continue;
    }

    if (tag === "tg-time") {
      const unix = parseSafeInt(getAttr(node, "unix"));
      const format = sanitizeDateTimeFormat(getAttr(node, "format"));
      const inner = parseInlineNodes(
        node.childNodes,
        ctx,
        refNames,
        normalizeWs,
      );
      if (unix !== undefined && !isEmptyRichText(inner)) {
        flushInlineBreak();
        out.push({
          type: "date_time",
          unix_time: unix,
          date_time_format: format,
          text: inner,
        });
      } else if (!isEmptyRichText(inner)) {
        flushInlineBreak(inner);
        out.push(inner);
      }
      continue;
    }

    if (tag === "tg-reference") {
      const name = getAttr(node, "name") ?? "";
      const inner = parseInlineNodes(
        node.childNodes,
        ctx,
        refNames,
        normalizeWs,
      );
      if (name && !isEmptyRichText(inner)) {
        flushInlineBreak();
        out.push({ type: "reference", name, text: inner });
      } else if (!isEmptyRichText(inner)) {
        flushInlineBreak(inner);
        out.push(inner);
      }
      continue;
    }

    if (tag === "tg-button") {
      const button = parseButtonFromElement(node, ctx, refNames, normalizeWs);
      if (button) {
        flushInlineBreak();
        out.push({ type: "button", button });
      }
      continue;
    }

    if (tag === "a") {
      const href = getAttr(node, "href");
      const name = getAttr(node, "name");
      if (name !== undefined && href === undefined) {
        flushInlineBreak();
        out.push({ type: "anchor", name });
        continue;
      }

      const inner = parseInlineNodes(
        node.childNodes,
        ctx,
        refNames,
        normalizeWs,
      );
      if (isEmptyRichText(inner)) continue;

      if (!href) {
        flushInlineBreak(inner);
        out.push(inner);
        continue;
      }

      flushInlineBreak();
      if (href.startsWith("mailto:")) {
        out.push({
          type: "email_address",
          email_address: href.slice("mailto:".length),
          text: inner,
        });
      } else if (href.startsWith("tel:")) {
        out.push({
          type: "phone_number",
          phone_number: href.slice("tel:".length),
          text: inner,
        });
      } else if (href.startsWith("tg://user?id=")) {
        const userId = parseSafeInt(href.slice("tg://user?id=".length));
        const user = userId !== undefined && userId > 0
          ? ctx.users.get(userId) ?? {
            id: userId,
            is_bot: false,
            first_name: richTextToPlainTextInternal(inner),
          }
          : undefined;
        if (user) {
          out.push({ type: "text_mention", user, text: inner });
        } else {
          out.push(inner);
        }
      } else if (href.startsWith("#")) {
        const target = href.slice(1);
        const linkKind = getAttr(node, "data-tg-link");
        if (
          linkKind === "reference" ||
          (linkKind !== "anchor" && refNames.has(target))
        ) {
          out.push({
            type: "reference_link",
            reference_name: target,
            text: inner,
          });
        } else {
          out.push({
            type: "anchor_link",
            anchor_name: target,
            text: inner,
          });
        }
      } else {
        out.push({ type: "url", url: href, text: inner });
      }
      continue;
    }

    const inner = parseInlineNodes(node.childNodes, ctx, refNames, normalizeWs);
    if (isEmptyRichText(inner)) continue;

    flushInlineBreak(inner);
    switch (tag) {
      case "b":
      case "strong":
        out.push({ type: "bold", text: inner });
        break;
      case "i":
      case "em":
        out.push({ type: "italic", text: inner });
        break;
      case "u":
      case "ins":
        out.push({ type: "underline", text: inner });
        break;
      case "s":
      case "strike":
      case "del":
        out.push({ type: "strikethrough", text: inner });
        break;
      case "tg-spoiler":
        out.push({ type: "spoiler", text: inner });
        break;
      case "span": {
        const cls = getAttr(node, "class") ?? "";
        if (cls.split(/\s+/).includes("tg-spoiler")) {
          out.push({ type: "spoiler", text: inner });
        } else {
          out.push(inner);
        }
        break;
      }
      case "sub":
        out.push({ type: "subscript", text: inner });
        break;
      case "sup":
        out.push({ type: "superscript", text: inner });
        break;
      case "mark":
        out.push({ type: "marked", text: inner });
        break;
      case "code":
        out.push({ type: "code", text: inner });
        break;
      default:
        out.push(inner);
        break;
    }
  }

  return normalizeRichTextNodes(out);
}

function parseCaptionElement(
  figcaptionEl: Element,
  ctx: RichHtmlContext,
  refNames: Set<string>,
  normalizeWs: boolean,
): RichBlockCaption | undefined {
  const textNodes: ChildNode[] = [];
  let creditEl: Element | undefined;

  for (const child of figcaptionEl.childNodes) {
    if (isElement(child) && child.tagName.toLowerCase() === "cite") {
      creditEl = child;
    } else {
      textNodes.push(child);
    }
  }

  const text = parseInlineNodes(textNodes, ctx, refNames, normalizeWs);
  const credit = creditEl
    ? parseInlineNodes(creditEl.childNodes, ctx, refNames, normalizeWs)
    : undefined;

  const hasCredit = credit !== undefined && !isEmptyRichText(credit);
  if (isEmptyRichText(text) && !hasCredit) return undefined;

  return {
    text,
    ...(hasCredit ? { credit } : {}),
  };
}

function parseMediaIdFromSrc(src: string): string | undefined {
  const match = src.match(/^tg:\/\/[a-z_]+\?id=([A-Za-z0-9_-]+)$/);
  return match?.[1];
}

function buildMediaBlockFromSaved(
  savedMedia: InputRichMessageMedia["media"],
  caption: RichBlockCaption | undefined,
): InputRichBlock {
  switch (savedMedia.type) {
    case "photo":
      return {
        type: "photo",
        photo: savedMedia,
        ...(caption ? { caption } : {}),
      };
    case "video":
      return {
        type: "video",
        video: savedMedia,
        ...(caption ? { caption } : {}),
      };
    case "animation":
      return {
        type: "animation",
        animation: savedMedia,
        ...(caption ? { caption } : {}),
      };
    case "audio":
      return {
        type: "audio",
        audio: savedMedia,
        ...(caption ? { caption } : {}),
      };
    case "voice_note":
      return {
        type: "voice_note",
        voice_note: savedMedia,
        ...(caption ? { caption } : {}),
      };
    case "document":
      return {
        type: "document",
        document: savedMedia,
        ...(caption ? { caption } : {}),
      };
  }
}

function parseMediaOrMapElement(
  el: Element,
  caption: RichBlockCaption | undefined,
  ctx: RichHtmlContext,
): InputRichBlock | undefined {
  const tag = el.tagName.toLowerCase();

  if (tag === "tg-map") {
    const savedMapId = getSavedMapId(el);
    if (savedMapId && ctx.preservedBlocks.has(savedMapId)) {
      const savedMap = ctx.preservedBlocks.get(savedMapId)!;
      if (savedMap.type === "map") {
        return { ...savedMap, ...(caption ? { caption } : {}) };
      }
    }
    const lat = parseFiniteNumber(getAttr(el, "lat"));
    const long = parseFiniteNumber(getAttr(el, "long"));
    if (lat === undefined || long === undefined) return undefined;
    const zoom = parseFiniteNumber(getAttr(el, "zoom"));
    const width = parseFiniteNumber(getAttr(el, "width"));
    const height = parseFiniteNumber(getAttr(el, "height"));
    return {
      type: "map",
      location: { latitude: lat, longitude: long },
      ...(zoom !== undefined ? { zoom } : {}),
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
      ...(caption ? { caption } : {}),
    };
  }

  const src = getAttr(el, "src") ?? "";
  const mediaId = parseMediaIdFromSrc(src);
  const savedMedia = mediaId ? ctx.media.get(mediaId) : undefined;
  const hasSpoiler = hasAttr(el, "tg-spoiler");

  if (savedMedia) {
    return buildMediaBlockFromSaved(savedMedia, caption);
  }

  if (!src || src.startsWith("tg://")) return undefined;

  if (tag === "img") {
    return {
      type: "photo",
      photo: {
        type: "photo",
        media: src,
        ...(hasSpoiler ? { has_spoiler: true } : {}),
      },
      ...(caption ? { caption } : {}),
    };
  }
  if (tag === "video") {
    const kind = getAttr(el, "data-tg-media-kind");
    if (kind === "animation" || src.toLowerCase().endsWith(".gif")) {
      return {
        type: "animation",
        animation: {
          type: "animation",
          media: src,
          ...(hasSpoiler ? { has_spoiler: true } : {}),
        },
        ...(caption ? { caption } : {}),
      };
    }
    return {
      type: "video",
      video: {
        type: "video",
        media: src,
        ...(hasSpoiler ? { has_spoiler: true } : {}),
      },
      ...(caption ? { caption } : {}),
    };
  }
  if (tag === "audio") {
    const kind = getAttr(el, "data-tg-media-kind");
    if (kind === "voice_note" || src.toLowerCase().endsWith(".ogg")) {
      return {
        type: "voice_note",
        voice_note: { type: "voice_note", media: src },
        ...(caption ? { caption } : {}),
      };
    }
    return {
      type: "audio",
      audio: { type: "audio", media: src },
      ...(caption ? { caption } : {}),
    };
  }
  if (tag === "tg-document") {
    return {
      type: "document",
      document: { type: "document", media: src },
      ...(caption ? { caption } : {}),
    };
  }

  return undefined;
}

const BLOCK_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "pre",
  "footer",
  "hr",
  "tg-math-block",
  "ul",
  "ol",
  "blockquote",
  "aside",
  "figure",
  "tg-map",
  "img",
  "video",
  "audio",
  "tg-document",
  "tg-collage",
  "tg-slideshow",
  "table",
  "details",
  "tg-button-row",
  "tg-thinking",
  "div",
  "section",
  "article",
]);

function isBlockLevelElement(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === "a") {
    return (
      hasAttr(el, "data-tg-block-anchor") ||
      (hasAttr(el, "name") && !hasAttr(el, "href"))
    );
  }
  if (tag === "img") {
    const src = getAttr(el, "src") ?? "";
    return !src.startsWith("tg://emoji?");
  }
  return BLOCK_TAGS.has(tag);
}

const GALLERY_MEDIA_BLOCK_TYPES = new Set<InputRichBlock["type"]>([
  "photo",
  "video",
  "animation",
  "audio",
  "voice_note",
  "document",
  "map",
]);

export function isGalleryMediaBlock(block: InputRichBlock): boolean {
  return GALLERY_MEDIA_BLOCK_TYPES.has(block.type);
}

function parseTableBlock(
  el: Element,
  ctx: RichHtmlContext,
  refNames: Set<string>,
  normalizeWs: boolean,
): InputRichBlock {
  let caption: RichText | undefined;
  const rows: RichBlockTableCell[][] = [];

  const collectRows = (container: Element) => {
    for (const child of container.childNodes) {
      if (!isElement(child)) continue;
      const tag = child.tagName.toLowerCase();
      if (tag === "caption") {
        const parsed = parseInlineNodes(
          child.childNodes,
          ctx,
          refNames,
          normalizeWs,
        );
        if (!isEmptyRichText(parsed)) caption = parsed;
      } else if (tag === "thead" || tag === "tbody" || tag === "tfoot") {
        collectRows(child);
      } else if (tag === "tr") {
        const row: RichBlockTableCell[] = [];
        for (const cellNode of child.childNodes) {
          if (!isElement(cellNode)) continue;
          const cellTag = cellNode.tagName.toLowerCase();
          if (cellTag !== "td" && cellTag !== "th") continue;

          const alignRaw = getAttr(cellNode, "align");
          const align = alignRaw === "center" || alignRaw === "right"
            ? alignRaw
            : "left";
          const valignRaw = getAttr(cellNode, "valign");
          const valign = valignRaw === "middle" || valignRaw === "bottom"
            ? valignRaw
            : "top";
          const colspan = parseSafeInt(getAttr(cellNode, "colspan"));
          const rowspan = parseSafeInt(getAttr(cellNode, "rowspan"));
          const isEmptyMarker = hasAttr(cellNode, "data-tg-empty");
          const parsedText = isEmptyMarker
            ? undefined
            : parseInlineNodes(cellNode.childNodes, ctx, refNames, normalizeWs);

          row.push({
            ...(parsedText !== undefined ? { text: parsedText } : {}),
            ...(cellTag === "th" ? { is_header: true } : {}),
            ...(colspan !== undefined && colspan > 1 ? { colspan } : {}),
            ...(rowspan !== undefined && rowspan > 1 ? { rowspan } : {}),
            align,
            valign,
          });
        }
        if (row.length > 0) rows.push(row);
      }
    }
  };

  collectRows(el);

  return {
    type: "table",
    cells: rows,
    ...(hasAttr(el, "bordered") ? { is_bordered: true } : {}),
    ...(hasAttr(el, "striped") ? { is_striped: true } : {}),
    ...(hasAttr(el, "compact") ? { is_compact: true } : {}),
    ...(caption !== undefined ? { caption } : {}),
  };
}

function parseListBlock(
  el: Element,
  ctx: RichHtmlContext,
  refNames: Set<string>,
  normalizeWs: boolean,
): InputRichBlock {
  const isOrdered = el.tagName.toLowerCase() === "ol";
  const listTypeAttr = getAttr(el, "type");
  const startNum = parseSafeInt(getAttr(el, "start"));
  const reversed = hasAttr(el, "reversed");

  const liElements = el.childNodes.filter(
    (child): child is Element =>
      isElement(child) && child.tagName.toLowerCase() === "li",
  );

  let nextOrderValue = startNum !== undefined
    ? startNum
    : reversed
    ? liElements.length
    : 1;

  const items: InputRichBlockListItem[] = [];

  for (const li of liElements) {
    let hasCheckbox = false;
    let isChecked = false;
    const contentNodes: ChildNode[] = [];

    for (const child of li.childNodes) {
      if (
        !hasCheckbox &&
        isElement(child) &&
        child.tagName.toLowerCase() === "input" &&
        (getAttr(child, "type") ?? "").toLowerCase() === "checkbox"
      ) {
        hasCheckbox = true;
        isChecked = hasAttr(child, "checked");
        continue;
      }
      contentNodes.push(child);
    }

    if (hasCheckbox && contentNodes.length > 0 && isTextNode(contentNodes[0])) {
      const trimmed = contentNodes[0].value.replace(/^[ \t]+/, "");
      contentNodes[0] = { ...contentNodes[0], value: trimmed };
    }

    const blocks = parseBlockNodes(contentNodes, ctx, refNames, normalizeWs);

    const isUnorderedItem = hasAttr(li, "data-tg-unordered");
    const parsedValue = parseSafeInt(getAttr(li, "value"));
    let itemValue: number | undefined;
    if (isOrdered && !isUnorderedItem) {
      if (parsedValue !== undefined) {
        itemValue = parsedValue;
        nextOrderValue = reversed ? itemValue - 1 : itemValue + 1;
      } else {
        itemValue = nextOrderValue;
        nextOrderValue = reversed ? nextOrderValue - 1 : nextOrderValue + 1;
      }
    }

    const itemTypeRaw = getAttr(li, "type") ??
      (isOrdered && !isUnorderedItem ? listTypeAttr : undefined);
    const itemType = itemTypeRaw === "a" || itemTypeRaw === "A" ||
        itemTypeRaw === "i" || itemTypeRaw === "I" || itemTypeRaw === "1"
      ? itemTypeRaw
      : isOrdered && !isUnorderedItem
      ? "1"
      : undefined;

    if (blocks.length === 0) continue;

    items.push({
      blocks,
      ...(hasCheckbox ? { has_checkbox: true } : {}),
      ...(isChecked ? { is_checked: true } : {}),
      ...(itemValue !== undefined ? { value: itemValue } : {}),
      ...(itemType !== undefined ? { type: itemType } : {}),
    });
  }

  return { type: "list", items };
}

function getPreservedBlockId(el: Element): string | undefined {
  const dataId = getAttr(el, "data-tg-block");
  if (dataId) return dataId;
  const htmlId = getAttr(el, "id");
  if (htmlId?.startsWith("tg-block-")) {
    return htmlId.slice("tg-block-".length);
  }
  return undefined;
}

function getSavedMediaId(el: Element): string | undefined {
  const dataId = getAttr(el, "data-tg-media");
  if (dataId) return dataId;
  const htmlId = getAttr(el, "id");
  if (htmlId?.startsWith("tg-media-")) {
    return htmlId.slice("tg-media-".length);
  }
  return undefined;
}

function getSavedMapId(el: Element): string | undefined {
  const dataId = getAttr(el, "data-tg-map-block");
  if (dataId) return dataId;
  const htmlId = getAttr(el, "id");
  if (htmlId?.startsWith("tg-map-")) {
    return htmlId.slice("tg-map-".length);
  }
  return undefined;
}

function parseBlockElement(
  el: Element,
  ctx: RichHtmlContext,
  refNames: Set<string>,
  normalizeWs: boolean,
): InputRichBlock[] {
  const preservedBlockId = getPreservedBlockId(el);
  if (preservedBlockId && ctx.preservedBlocks.has(preservedBlockId)) {
    return [ctx.preservedBlocks.get(preservedBlockId)!];
  }

  const tag = el.tagName.toLowerCase();

  if (tag === "div" || tag === "section" || tag === "article") {
    return parseBlockNodes(el.childNodes, ctx, refNames, normalizeWs);
  }

  if (tag === "p") {
    const text = parseInlineNodes(el.childNodes, ctx, refNames, normalizeWs);
    return isEmptyRichText(text) ? [] : [{ type: "paragraph", text }];
  }

  if (/^h[1-6]$/.test(tag)) {
    const size = Number(tag[1]) as 1 | 2 | 3 | 4 | 5 | 6;
    const text = parseInlineNodes(el.childNodes, ctx, refNames, normalizeWs);
    return isEmptyRichText(text) ? [] : [{ type: "heading", size, text }];
  }

  if (tag === "pre") {
    const codeChild = el.childNodes.find(
      (n): n is Element => isElement(n) && n.tagName.toLowerCase() === "code",
    );
    const className = codeChild ? getAttr(codeChild, "class") ?? "" : "";
    const langMatch = className.match(/(?:^|\s)language-([^\s]+)/);
    const text = getRawTextContent(codeChild ?? el);
    if (text.length === 0) return [];
    return [{
      type: "pre",
      text,
      ...(langMatch ? { language: langMatch[1] } : {}),
    }];
  }

  if (tag === "footer") {
    const text = parseInlineNodes(el.childNodes, ctx, refNames, normalizeWs);
    return isEmptyRichText(text) ? [] : [{ type: "footer", text }];
  }

  if (tag === "hr") {
    return [{ type: "divider" }];
  }

  if (tag === "tg-math-block") {
    const expression = getRawTextContent(el);
    if (expression.length === 0) return [];
    return [{ type: "mathematical_expression", expression }];
  }

  if (tag === "a") {
    const name = getAttr(el, "name");
    if (name !== undefined && !hasAttr(el, "href")) {
      return [{ type: "anchor", name }];
    }
    return [];
  }

  if (tag === "ul" || tag === "ol") {
    const list = parseListBlock(el, ctx, refNames, normalizeWs);
    return list.type === "list" && list.items.length > 0 ? [list] : [];
  }

  if (tag === "blockquote") {
    const contentNodes: ChildNode[] = [];
    let creditEl: Element | undefined;

    for (const child of el.childNodes) {
      if (isElement(child) && child.tagName.toLowerCase() === "cite") {
        creditEl = child;
      } else {
        contentNodes.push(child);
      }
    }

    const blocks = parseBlockNodes(contentNodes, ctx, refNames, normalizeWs);
    const credit = creditEl
      ? parseInlineNodes(creditEl.childNodes, ctx, refNames, normalizeWs)
      : undefined;
    const hasCredit = credit !== undefined && !isEmptyRichText(credit);
    if (blocks.length === 0) {
      return hasCredit ? [{ type: "paragraph", text: credit }] : [];
    }

    if (hasAttr(el, "expandable")) {
      return [{
        type: "expandable_blockquote",
        blocks,
        ...(hasCredit ? { credit } : {}),
      }];
    }
    return [{
      type: "blockquote",
      blocks,
      ...(hasCredit ? { credit } : {}),
    }];
  }

  if (tag === "aside") {
    const textNodes: ChildNode[] = [];
    let creditEl: Element | undefined;

    for (const child of el.childNodes) {
      if (isElement(child) && child.tagName.toLowerCase() === "cite") {
        creditEl = child;
      } else {
        textNodes.push(child);
      }
    }

    const text = parseInlineNodes(textNodes, ctx, refNames, normalizeWs);
    const credit = creditEl
      ? parseInlineNodes(creditEl.childNodes, ctx, refNames, normalizeWs)
      : undefined;
    const hasCredit = credit !== undefined && !isEmptyRichText(credit);
    if (isEmptyRichText(text)) {
      return hasCredit ? [{ type: "paragraph", text: credit }] : [];
    }

    return [{
      type: "pullquote",
      text,
      ...(hasCredit ? { credit } : {}),
    }];
  }

  if (tag === "figure") {
    let mediaEl: Element | undefined;
    let figcaptionEl: Element | undefined;

    for (const child of el.childNodes) {
      if (!isElement(child)) continue;
      const childTag = child.tagName.toLowerCase();
      if (childTag === "figcaption") {
        figcaptionEl = child;
      } else if (
        childTag === "img" ||
        childTag === "video" ||
        childTag === "audio" ||
        childTag === "tg-document" ||
        childTag === "tg-map"
      ) {
        mediaEl = child;
      }
    }

    const caption = figcaptionEl
      ? parseCaptionElement(figcaptionEl, ctx, refNames, normalizeWs)
      : undefined;

    // Prefer authoritative figure metadata from translate mode so mangled inner
    // src/coordinates or stripped void tags still recover the exact original media/map.
    const fallbackMediaId = getSavedMediaId(el);
    if (fallbackMediaId && ctx.media.has(fallbackMediaId)) {
      return [
        buildMediaBlockFromSaved(ctx.media.get(fallbackMediaId)!, caption),
      ];
    }
    const fallbackMapId = getSavedMapId(el);
    if (fallbackMapId && ctx.preservedBlocks.has(fallbackMapId)) {
      const savedMap = ctx.preservedBlocks.get(fallbackMapId)!;
      if (savedMap.type === "map") {
        return [{ ...savedMap, ...(caption ? { caption } : {}) }];
      }
    }

    if (mediaEl) {
      const parsed = parseMediaOrMapElement(mediaEl, caption, ctx);
      if (parsed) return [parsed];
    }

    return [];
  }

  if (
    tag === "img" ||
    tag === "video" ||
    tag === "audio" ||
    tag === "tg-document" ||
    tag === "tg-map"
  ) {
    const parsed = parseMediaOrMapElement(el, undefined, ctx);
    return parsed ? [parsed] : [];
  }

  if (tag === "tg-collage" || tag === "tg-slideshow") {
    const mediaNodes: ChildNode[] = [];
    let figcaptionEl: Element | undefined;

    for (const child of el.childNodes) {
      if (isElement(child) && child.tagName.toLowerCase() === "figcaption") {
        figcaptionEl = child;
      } else {
        mediaNodes.push(child);
      }
    }

    const blocks = parseBlockNodes(mediaNodes, ctx, refNames, normalizeWs)
      .filter((b) => GALLERY_MEDIA_BLOCK_TYPES.has(b.type));
    if (blocks.length === 0) return [];
    const caption = figcaptionEl
      ? parseCaptionElement(figcaptionEl, ctx, refNames, normalizeWs)
      : undefined;

    return [{
      type: tag === "tg-collage" ? "collage" : "slideshow",
      blocks,
      ...(caption ? { caption } : {}),
    }];
  }

  if (tag === "table") {
    const table = parseTableBlock(el, ctx, refNames, normalizeWs);
    return table.type === "table" && table.cells.length > 0 ? [table] : [];
  }

  if (tag === "details") {
    let summaryEl: Element | undefined;
    const bodyNodes: ChildNode[] = [];

    for (const child of el.childNodes) {
      if (
        !summaryEl && isElement(child) &&
        child.tagName.toLowerCase() === "summary"
      ) {
        summaryEl = child;
      } else {
        bodyNodes.push(child);
      }
    }

    const summary = summaryEl
      ? parseInlineNodes(summaryEl.childNodes, ctx, refNames, normalizeWs)
      : "";
    const blocks = parseBlockNodes(bodyNodes, ctx, refNames, normalizeWs);
    if (isEmptyRichText(summary) && blocks.length === 0) return [];
    if (blocks.length === 0) return [{ type: "paragraph", text: summary }];
    if (isEmptyRichText(summary)) return blocks;

    return [{
      type: "details",
      summary,
      blocks,
      ...(hasAttr(el, "open") ? { is_open: true } : {}),
    }];
  }

  if (tag === "tg-button-row") {
    const alignRaw = getAttr(el, "align");
    const align = alignRaw === "left" || alignRaw === "center" ||
        alignRaw === "right"
      ? alignRaw
      : undefined;
    const buttons: RichMessageButton[] = [];
    for (const child of el.childNodes) {
      if (isElement(child) && child.tagName.toLowerCase() === "tg-button") {
        const button = parseButtonFromElement(
          child,
          ctx,
          refNames,
          normalizeWs,
        );
        if (button) buttons.push(button);
      }
    }
    if (buttons.length === 0) return [];
    return [{
      type: "buttons",
      buttons,
      ...(align ? { align } : {}),
    }];
  }

  if (tag === "tg-thinking") {
    const text = parseInlineNodes(el.childNodes, ctx, refNames, normalizeWs);
    return isEmptyRichText(text) ? [] : [{ type: "thinking", text }];
  }

  return [];
}

function parseBlockNodes(
  nodes: ChildNode[],
  ctx: RichHtmlContext,
  refNames: Set<string>,
  normalizeWs: boolean,
): InputRichBlock[] {
  const blocks: InputRichBlock[] = [];
  let inlineBuffer: ChildNode[] = [];

  const flushInlineBuffer = () => {
    if (inlineBuffer.length === 0) return;
    const hasMeaningfulContent = inlineBuffer.some((node) => {
      if (isTextNode(node)) return /\S/.test(node.value);
      return isElement(node);
    });
    if (hasMeaningfulContent) {
      const text = parseInlineNodes(inlineBuffer, ctx, refNames, normalizeWs);
      if (!isEmptyRichText(text)) {
        blocks.push({ type: "paragraph", text });
      }
    }
    inlineBuffer = [];
  };

  for (const node of nodes) {
    if (isElement(node) && isBlockLevelElement(node)) {
      flushInlineBuffer();
      blocks.push(...parseBlockElement(node, ctx, refNames, normalizeWs));
    } else if (isTextNode(node) || isElement(node)) {
      inlineBuffer.push(node);
    }
  }

  flushInlineBuffer();
  return blocks;
}

export function htmlToInputRichBlocks(
  html: string,
  context?: RichHtmlContext,
  options?: HtmlToRichOptions,
): InputRichBlock[] {
  const ctx = context ?? createRichHtmlContext();
  const normalizeWs = options?.normalizeTranslatedWhitespace ?? false;
  const fragment = parseFragment(html);
  const refNames = new Set<string>(ctx.referenceNames);
  collectReferenceNames(fragment.childNodes, refNames);
  return parseBlockNodes(fragment.childNodes, ctx, refNames, normalizeWs);
}

export function htmlToInputRichMessage(
  html: string,
  context?: RichHtmlContext,
  options?: HtmlToRichOptions,
): InputRichMessage {
  const blocks = htmlToInputRichBlocks(html, context, options);
  return {
    blocks,
    ...(context?.isRtl !== undefined ? { is_rtl: context.isRtl } : {}),
  };
}
