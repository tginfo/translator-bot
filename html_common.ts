import type { DefaultTreeAdapterTypes } from "parse5";
import type { MessageEntity } from "grammy/types.ts";

export type ChildNode = DefaultTreeAdapterTypes.ChildNode;
export type Element = DefaultTreeAdapterTypes.Element;
export type TextNode = DefaultTreeAdapterTypes.TextNode;
export type TelegramDateTimeFormat =
  MessageEntity.DateTimeMessageEntity["date_time_format"];

const DATE_TIME_FORMAT_RE = /^(?:r|w?[dD]?[tT]?)$/;
const OPENING_PUNCT_OR_SPACE_RE = /[\s(\[{<«“‘"'\u2013\u2014]/;
const CLOSING_PUNCT_OR_SPACE_RE = /[\s)\]}»”’"']/;
const SMARTYPANTS_ESCAPE_RE = /\\([\\"'`.-])/g;
const CJK_CHAR_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const WORD_CHAR_RE = /[\p{L}\p{N}]/u;
const OPENING_NO_SPACE_AFTER_BASE_RE = /[(\[{（［｛【「『《〈〔〖“‘„‚]/;
const OPENING_NO_SPACE_AFTER_NON_FR_RE = /[(\[{（［｛【「『《〈〔〖“‘„‚«‹]/;
const CLOSING_NO_SPACE_BEFORE_BASE_RE =
  /[,…)\]\}）］｝】」』》〉〕〗”’。，、；：！？]/;
const CLOSING_NO_SPACE_BEFORE_NON_FR_RE =
  /[,…;:!?)\]\}）］｝】」』》〉〕〗”’»›。，、；：！？]/;
const HOIST_NO_SPACE_BEFORE_RE = /[/\\\-@#]$/;
const HOIST_NO_SPACE_AFTER_RE = /^[/\\\-]/;
const ENGLISH_APOSTROPHE_SUFFIX_RE =
  /^'(?:s|re|ve|ll|d|m)(?=$|[\s.,;:!?)\]\}»”’"'])/i;
const FRENCH_LANG_RE = /^fr(?:[-_]|$)/i;

const BLOCK_CONTAINER_TAGS = new Set([
  "p", "div", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "footer",
  "aside", "figure", "figcaption", "cite", "caption", "table", "thead",
  "tbody", "tfoot", "tr", "td", "th", "ul", "ol", "li", "details", "summary",
  "section", "article", "hr", "pre", "tg-math-block", "tg-map", "tg-document",
  "tg-collage", "tg-slideshow", "tg-button-row", "tg-thinking", "video",
  "audio",
]);

const VERBATIM_TAGS = new Set([
  "pre", "code", "tg-emoji", "tg-math", "tg-math-block", "tg-map",
  "tg-document", "img", "video", "audio", "hr", "input",
]);

const HOISTABLE_INLINE_TAGS = new Set([
  "a", "b", "strong", "i", "em", "u", "ins", "s", "strike", "del",
  "tg-spoiler", "span", "tg-time", "sub", "sup", "mark", "tg-reference",
]);

export function isElement(node: ChildNode): node is Element {
  return "tagName" in node;
}

export function isTextNode(node: ChildNode): node is TextNode {
  return node.nodeName === "#text";
}

export function getAttr(el: Element, name: string): string | undefined {
  const lower = name.toLowerCase();
  return el.attrs.find((a) => a.name.toLowerCase() === lower)?.value;
}

export function hasAttr(el: Element, name: string): boolean {
  const lower = name.toLowerCase();
  return el.attrs.some((a) => a.name.toLowerCase() === lower);
}

export function getRawTextContent(node: ChildNode): string {
  if (isTextNode(node)) return node.value;
  if (isElement(node)) {
    if (node.tagName.toLowerCase() === "br") return "\n";
    return node.childNodes.map(getRawTextContent).join("");
  }
  return "";
}

export function escapeHtmlText(text: string, preserveNewlines = false): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return preserveNewlines ? escaped : escaped.replace(/\r?\n/g, "<br>");
}

/**
 * Escapes raw text placed directly inside a bare `<pre>...</pre>` element.
 * Per HTML5 parsing rules, a single leading newline immediately after `<pre>`
 * is stripped by parsers (including parse5), so we prepend an extra `\n`
 * whenever the content begins with a newline.
 */
export function escapeBarePreHtml(text: string): string {
  const escaped = escapeHtmlText(text, true);
  return escaped.startsWith("\n") || escaped.startsWith("\r\n")
    ? `\n${escaped}`
    : escaped;
}

export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Strict finite number parser for HTML attributes.
 * Unlike `Number("") === 0`, rejects `undefined`, empty, and whitespace-only strings.
 */
export function parseFiniteNumber(
  raw: string | undefined,
): number | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseSafeInt(raw: string | undefined): number | undefined {
  const parsed = parseFiniteNumber(raw);
  return parsed !== undefined && Number.isSafeInteger(parsed)
    ? parsed
    : undefined;
}

export function sanitizeDateTimeFormat(
  raw: string | undefined,
): TelegramDateTimeFormat {
  if (raw !== undefined && DATE_TIME_FORMAT_RE.test(raw)) {
    return raw as TelegramDateTimeFormat;
  }
  return "";
}

export function normalizeUrlForComparison(url: string): string {
  return url.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "")
    .toLowerCase();
}

export function isBareUrlText(plainText: string, targetUrl: string): boolean {
  const trimmed = plainText.trim();
  if (!trimmed) return true;
  if (trimmed.toLowerCase() === targetUrl.trim().toLowerCase()) return true;
  return normalizeUrlForComparison(trimmed) ===
    normalizeUrlForComparison(targetUrl);
}

/**
 * Ensures a UTF-16 slice index does not split a surrogate pair.
 */
export function adjustSplitForSurrogate(text: string, index: number): number {
  if (index <= 0 || index >= text.length) return index;
  const prev = text.charCodeAt(index - 1);
  const next = text.charCodeAt(index);
  if (prev >= 0xD800 && prev <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) {
    return index > 1 ? index - 1 : index + 1;
  }
  return index;
}

/**
 * Truncates text to at most `maxLength` UTF-16 code units with an ellipsis
 * without splitting a UTF-16 surrogate pair.
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  if (maxLength <= 0) return "";
  const isSplitSurrogate = (idx: number): boolean =>
    idx > 0 &&
    idx < text.length &&
    text.charCodeAt(idx - 1) >= 0xD800 &&
    text.charCodeAt(idx - 1) <= 0xDBFF &&
    text.charCodeAt(idx) >= 0xDC00 &&
    text.charCodeAt(idx) <= 0xDFFF;

  if (maxLength <= 3) {
    const cut = isSplitSurrogate(maxLength) ? maxLength - 1 : maxLength;
    return text.slice(0, cut);
  }
  const target = maxLength - 3;
  const cut = isSplitSurrogate(target) ? target - 1 : target;
  return text.slice(0, cut) + "...";
}

export interface TextSplitChunk {
  text: string;
  separatorAfter: string;
}

/**
 * Splits text into chunks <= maxChunkChars while recording the exact separator
 * removed between chunks so reassembly preserves original paragraph, line, and
 * word boundaries without breaking UTF-16 surrogate pairs.
 */
export function splitTextPreservingSeparators(
  text: string,
  maxChunkChars: number,
): TextSplitChunk[] {
  if (text.length <= maxChunkChars) {
    return [{ text, separatorAfter: "" }];
  }

  const chunks: TextSplitChunk[] = [];
  let remaining = text;

  while (remaining.length > maxChunkChars) {
    let splitAt = -1;
    let sep = "";

    const dblNl = remaining.lastIndexOf("\n\n", maxChunkChars);
    if (dblNl > 0) {
      splitAt = dblNl;
      sep = "\n\n";
    } else {
      const nl = remaining.lastIndexOf("\n", maxChunkChars);
      if (nl > 0) {
        splitAt = nl;
        sep = "\n";
      } else {
        const sp = remaining.lastIndexOf(" ", maxChunkChars);
        if (sp > 0) {
          splitAt = sp;
          sep = " ";
        } else {
          splitAt = adjustSplitForSurrogate(remaining, maxChunkChars);
          sep = "";
        }
      }
    }

    chunks.push({ text: remaining.slice(0, splitAt), separatorAfter: sep });
    remaining = remaining.slice(splitAt + sep.length);
  }

  if (remaining.length > 0) {
    chunks.push({ text: remaining, separatorAfter: "" });
  }

  return chunks;
}

/**
 * Splits plain text into bounded chunks and translates only chunks containing
 * non-whitespace text, preserving exact separators and whitespace-only chunks
 * verbatim without sending empty/whitespace payloads to the translator.
 */
export async function translatePlainTextChunks(
  text: string,
  translateBatch: (contents: string[]) => Promise<string[]>,
  maxChunkChars = 18_000,
): Promise<string> {
  const chunks = splitTextPreservingSeparators(text, maxChunkChars);
  const translatableIndices: number[] = [];
  const batch: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    if (/\S/.test(chunks[i].text)) {
      translatableIndices.push(i);
      batch.push(chunks[i].text);
    }
  }

  if (batch.length === 0) {
    return text;
  }

  const translated = await translateBatch(batch);
  if (translated.length !== batch.length) {
    throw new Error(
      `Translation chunk count mismatch: expected ${batch.length}, received ${translated.length}.`,
    );
  }

  const translatedByIdx = new Map<number, string>();
  for (let i = 0; i < translatableIndices.length; i++) {
    translatedByIdx.set(translatableIndices[i], translated[i]);
  }

  let joined = "";
  for (let i = 0; i < chunks.length; i++) {
    joined += translatedByIdx.get(i) ?? chunks[i].text;
    joined += chunks[i].separatorAfter;
  }
  return joined;
}

/**
 * Applies a string typography transform (e.g. smartypants) to a single prose
 * segment while preserving quote direction across formatting boundaries.
 */
export function applyTypographyWithContext(
  segment: string,
  prevChar: string,
  nextChar: string,
  fixString: (text: string) => string,
): string {
  if (!segment) return segment;

  const needsLeadingWord = prevChar.length > 0 &&
    !OPENING_PUNCT_OR_SPACE_RE.test(prevChar);
  const needsTrailingWord = nextChar.length > 0 &&
    !CLOSING_PUNCT_OR_SPACE_RE.test(nextChar);

  const prefix = needsLeadingWord ? "X" : "";
  const suffix = needsTrailingWord ? "Y" : "";
  const transformed = fixString(`${prefix}${segment}${suffix}`);

  if (
    (!prefix || transformed.startsWith(prefix)) &&
    (!suffix || transformed.endsWith(suffix))
  ) {
    return transformed.slice(
      prefix.length,
      suffix ? transformed.length - suffix.length : undefined,
    );
  }
  return fixString(segment);
}

/**
 * Wraps an HTML-oriented smartypants function (e.g. `smartypantsu`) for plain
 * text so backslash-escaped punctuation (`\\`, `\"`, `\'`, `\-`, `\.`, `` \` ``)
 * is preserved verbatim instead of being emitted as literal HTML entities
 * (`&#34;`, `&#92;`, etc.).
 */
export function createPlainTextSmartypants(
  smartypantsFn: (text: string) => string,
): (text: string) => string {
  return (text: string): string => {
    if (!text.includes("\\")) {
      return smartypantsFn(text);
    }
    const saved: string[] = [];
    let tokenPrefix = "\uE000SP";
    while (text.includes(tokenPrefix)) {
      tokenPrefix += "X";
    }
    const protectedText = text.replace(SMARTYPANTS_ESCAPE_RE, (match) => {
      const idx = saved.length;
      saved.push(match);
      return `${tokenPrefix}${idx}\uE001`;
    });
    if (saved.length === 0) {
      return smartypantsFn(text);
    }
    const transformed = smartypantsFn(protectedText);
    return transformed.replace(
      new RegExp(`${tokenPrefix}(\\d+)\uE001`, "g"),
      (match, idxStr) => saved[Number(idxStr)] ?? match,
    );
  };
}

export interface NormalizeTranslatedDomOptions {
  targetLanguage?: string;
  getPreservedText?: (el: Element) => string | undefined;
}

function isDomBlockElement(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === "a") {
    return (
      hasAttr(el, "data-tg-block-anchor") ||
      (hasAttr(el, "name") && !hasAttr(el, "href"))
    );
  }
  if (tag === "img") {
    return !(getAttr(el, "src") ?? "").startsWith("tg://emoji?");
  }
  return BLOCK_CONTAINER_TAGS.has(tag);
}

function isDomVerbatimElement(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (VERBATIM_TAGS.has(tag)) return true;
  if (
    hasAttr(el, "data-tg-leaf") ||
    hasAttr(el, "data-tg-inline") ||
    hasAttr(el, "data-tg-block")
  ) {
    return true;
  }
  const id = getAttr(el, "id") ?? "";
  if (id.startsWith("tg-leaf-") || id.startsWith("tg-block-")) {
    return true;
  }
  if ((getAttr(el, "translate") ?? "").toLowerCase() === "no") {
    return true;
  }
  if (tag === "a" && hasAttr(el, "name") && !hasAttr(el, "href")) {
    return true;
  }
  return false;
}

function isDomInlineElement(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === "br" || tag === "input") return false;
  return !isDomBlockElement(el);
}

function isDomHoistableInlineElement(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  return (
    HOISTABLE_INLINE_TAGS.has(tag) &&
    !isDomVerbatimElement(el) &&
    !isDomBlockElement(el)
  );
}

function createTextNode(value: string): TextNode {
  return { nodeName: "#text", value, parentNode: null } as TextNode;
}

function getBoundaryChar(
  node: ChildNode,
  side: "first" | "last",
  getPreservedText?: (el: Element) => string | undefined,
): string {
  if (isTextNode(node)) {
    if (node.value.length === 0) return "";
    return side === "first" ? node.value[0] : node.value[node.value.length - 1];
  }
  if (!isElement(node)) return "";
  if (node.tagName.toLowerCase() === "br") return "\n";
  const preserved = getPreservedText?.(node);
  if (preserved !== undefined) {
    if (preserved.length === 0) return "";
    return side === "first" ? preserved[0] : preserved[preserved.length - 1];
  }
  const len = node.childNodes.length;
  for (let i = 0; i < len; i++) {
    const child = node.childNodes[side === "first" ? i : len - 1 - i];
    const ch = getBoundaryChar(child, side, getPreservedText);
    if (ch) return ch;
  }
  return "";
}

/**
 * Normalizes spurious horizontal whitespace that translation APIs (such as
 * Google Cloud Translation in `text/html` mode) commonly inject around `<br>`
 * tags and inside or around inline HTML tags (especially `<a>` hyperlinks and
 * `translate="no"` spans), while preserving verbatim/code elements and never
 * gluing separate words together.
 */
export function normalizeTranslatedDomWhitespace(
  nodes: ChildNode[],
  options?: NormalizeTranslatedDomOptions,
): void {
  const isFrench = options?.targetLanguage !== undefined &&
    FRENCH_LANG_RE.test(options.targetLanguage.trim());
  const getPreservedText = options?.getPreservedText;
  const openingNoSpaceRe = isFrench
    ? OPENING_NO_SPACE_AFTER_BASE_RE
    : OPENING_NO_SPACE_AFTER_NON_FR_RE;
  const closingNoSpaceRe = isFrench
    ? CLOSING_NO_SPACE_BEFORE_BASE_RE
    : CLOSING_NO_SPACE_BEFORE_NON_FR_RE;

  const isBreakOrBlock = (node: ChildNode | undefined): boolean =>
    node !== undefined && isElement(node) &&
    (node.tagName.toLowerCase() === "br" || isDomBlockElement(node));

  const normalizeList = (
    list: ChildNode[],
    isBlockContainer: boolean,
  ): { leadingWs: string; trailingWs: string } => {
    // Pass 1: Strip spaces next to `<br>` on raw text nodes, recurse bottom-up,
    // and hoist leading/trailing horizontal spaces out of hoistable inline tags
    // so all boundary rules run in one unified pass.
    const cleaned: ChildNode[] = [];
    for (let i = 0; i < list.length; i++) {
      const node = list[i];
      if (!isTextNode(node)) {
        cleaned.push(node);
        continue;
      }
      let val = node.value;
      const prev = list[i - 1];
      const next = list[i + 1];
      if (prev && isElement(prev) && prev.tagName.toLowerCase() === "br") {
        val = val.replace(/^[ \t]/, "");
      }
      if (next && isElement(next) && next.tagName.toLowerCase() === "br") {
        val = val.replace(/[ \t]+$/, "");
      }
      if (val.length > 0) {
        cleaned.push(val === node.value ? node : createTextNode(val));
      }
    }

    const expanded: ChildNode[] = [];
    const appendNode = (node: ChildNode) => {
      if (isTextNode(node)) {
        if (node.value.length === 0) return;
        const prev = expanded[expanded.length - 1];
        if (prev && isTextNode(prev)) {
          expanded[expanded.length - 1] = createTextNode(prev.value + node.value);
        } else {
          expanded.push(node);
        }
      } else {
        expanded.push(node);
      }
    };

    for (let i = 0; i < cleaned.length; i++) {
      const node = cleaned[i];
      if (!isElement(node) || isDomVerbatimElement(node)) {
        appendNode(node);
        continue;
      }
      const tag = node.tagName.toLowerCase();
      if (tag === "br") {
        appendNode(node);
        continue;
      }
      if (!isDomHoistableInlineElement(node)) {
        if (node.childNodes.length > 0) {
          normalizeList(node.childNodes, true);
        }
        appendNode(node);
        continue;
      }

      const hadChildren = node.childNodes.length > 0;
      const { leadingWs, trailingWs } = normalizeList(node.childNodes, false);
      const prevNode = expanded[expanded.length - 1];
      const nextNode = cleaned[i + 1];

      if (hadChildren && node.childNodes.length === 0) {
        // Whitespace-only inline element: drop the empty tag and keep at most
        // one space if it separated two non-space siblings.
        if (
          prevNode && nextNode &&
          !isBreakOrBlock(prevNode) && !isBreakOrBlock(nextNode)
        ) {
          if (
            isTextNode(prevNode) && isTextNode(nextNode) &&
            /[ \t]$/.test(prevNode.value) && /^[ \t]/.test(nextNode.value)
          ) {
            cleaned[i + 1] = createTextNode(nextNode.value.replace(/^[ \t]+/, ""));
          } else if (
            !/\s/.test(getBoundaryChar(prevNode, "last", getPreservedText)) &&
            !/\s/.test(getBoundaryChar(nextNode, "first", getPreservedText))
          ) {
            appendNode(createTextNode(" "));
          }
        }
        continue;
      }

      const allowLeading = leadingWs.length > 0 && (
        prevNode === undefined
          ? !isBlockContainer
          : (!isBreakOrBlock(prevNode) &&
            !(isTextNode(prevNode) && HOIST_NO_SPACE_BEFORE_RE.test(prevNode.value)))
      );
      const allowTrailing = trailingWs.length > 0 && (
        nextNode === undefined
          ? !isBlockContainer
          : (!isBreakOrBlock(nextNode) &&
            !(isTextNode(nextNode) && HOIST_NO_SPACE_AFTER_RE.test(nextNode.value)))
      );

      if (allowLeading) appendNode(createTextNode(leadingWs));
      appendNode(node);
      if (allowTrailing) appendNode(createTextNode(trailingWs));
    }

    // For hoistable inline containers, lift edge horizontal spaces to parent
    // before outer boundary normalization runs at the enclosing block level.
    let leadingWs = "";
    let trailingWs = "";
    if (!isBlockContainer) {
      const first = expanded[0];
      if (first && isTextNode(first)) {
        const m = first.value.match(/^[ \t]+/);
        if (m) {
          leadingWs = m[0];
          const rest = first.value.slice(m[0].length);
          if (rest.length === 0) expanded.shift();
          else expanded[0] = createTextNode(rest);
        }
      }
      const last = expanded[expanded.length - 1];
      if (last && isTextNode(last)) {
        const m = last.value.match(/[ \t]+$/);
        if (m) {
          trailingWs = m[0];
          const rest = last.value.slice(0, last.value.length - m[0].length);
          if (rest.length === 0) expanded.pop();
          else expanded[expanded.length - 1] = createTextNode(rest);
        }
      }
    }

    // Pass 2: Normalize horizontal spaces directly adjacent to inline elements
    // (covers both originally-outside spaces and spaces hoisted in Pass 1).
    for (let i = 0; i < expanded.length; i++) {
      const node = expanded[i];
      if (!isTextNode(node)) continue;

      let val = node.value;
      const prev = expanded[i - 1];
      const next = expanded[i + 1];
      const prevIsInline = prev !== undefined && isElement(prev) &&
        isDomInlineElement(prev);
      const nextIsInline = next !== undefined && isElement(next) &&
        isDomInlineElement(next);

      if (
        /^[ \t]+$/.test(val) && (
          (isBlockContainer && ((i === 0 && nextIsInline) ||
            (i === expanded.length - 1 && prevIsInline))) ||
          (isBreakOrBlock(prev) && nextIsInline) ||
          (prevIsInline && isBreakOrBlock(next))
        )
      ) {
        val = "";
      }

      if (val.length > 0 && prevIsInline) {
        if (nextIsInline && /^[ \t]{2,}$/.test(val)) {
          val = " ";
        } else {
          val = val.replace(/^[ \t]{2,}(\S)/, " $1");
        }

        const leadingMatch = val.match(/^[ \t]+/);
        if (leadingMatch) {
          const afterWs = val.slice(leadingMatch[0].length);
          const prevLast = getBoundaryChar(prev!, "last", getPreservedText);

          if (afterWs.length === 0) {
            const nextFirst = nextIsInline
              ? getBoundaryChar(next!, "first", getPreservedText)
              : "";
            if (prevLast && nextFirst && CJK_CHAR_RE.test(prevLast) &&
              CJK_CHAR_RE.test(nextFirst)) {
              val = "";
            }
          } else {
            const firstAfter = afterWs[0];
            const charAfterFirst = afterWs.length > 1
              ? afterWs[1]
              : (next ? getBoundaryChar(next, "first", getPreservedText) : "");
            const isClosingPeriod = firstAfter === "." &&
              (!charAfterFirst || charAfterFirst === "." ||
                !WORD_CHAR_RE.test(charAfterFirst));
            const isClosingQuote = (firstAfter === '"' || firstAfter === "'") &&
              (!charAfterFirst || charAfterFirst === "\n" ||
                closingNoSpaceRe.test(charAfterFirst) ||
                charAfterFirst === "." ||
                (/[ \t]/.test(charAfterFirst) && expanded[i - 2] !== undefined &&
                  getBoundaryChar(expanded[i - 2], "last", getPreservedText) ===
                    firstAfter));

            if (
              (prevLast && CJK_CHAR_RE.test(prevLast) &&
                CJK_CHAR_RE.test(firstAfter)) ||
              closingNoSpaceRe.test(firstAfter) ||
              isClosingPeriod ||
              ENGLISH_APOSTROPHE_SUFFIX_RE.test(afterWs) ||
              isClosingQuote
            ) {
              val = afterWs;
            }
          }
        }
      }

      if (val.length > 0 && nextIsInline) {
        val = val.replace(/(\S)[ \t]{2,}$/, "$1 ");

        const trailingMatch = val.match(/[ \t]+$/);
        if (trailingMatch) {
          const beforeWs = val.slice(0, val.length - trailingMatch[0].length);
          const lastBefore = beforeWs.length > 0
            ? beforeWs[beforeWs.length - 1]
            : "";
          const nextFirst = getBoundaryChar(next!, "first", getPreservedText);
          const charBeforeLast = beforeWs.length > 1
            ? beforeWs[beforeWs.length - 2]
            : (prev ? getBoundaryChar(prev, "last", getPreservedText) : "");
          const isOpeningQuote = (lastBefore === '"' || lastBefore === "'") &&
            (!charBeforeLast || /\s/.test(charBeforeLast) ||
              openingNoSpaceRe.test(charBeforeLast));

          if (
            (lastBefore && nextFirst && CJK_CHAR_RE.test(lastBefore) &&
              CJK_CHAR_RE.test(nextFirst)) ||
            (lastBefore && openingNoSpaceRe.test(lastBefore)) ||
            isOpeningQuote
          ) {
            val = beforeWs;
          }
        }
      }

      if (val !== node.value) {
        expanded[i] = createTextNode(val);
      }
    }

    list.length = 0;
    for (const node of expanded) {
      if (isTextNode(node) && node.value.length === 0) continue;
      list.push(node);
    }

    return { leadingWs, trailingWs };
  };

  normalizeList(nodes, true);
}
