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
