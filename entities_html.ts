import { parseFragment } from "parse5";
import type { MessageEntity } from "grammy/types.ts";
import {
  adjustSplitForSurrogate,
  applyTypographyWithContext,
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
  normalizeTranslatedDomWhitespace,
  parseSafeInt,
  sanitizeDateTimeFormat,
} from "./html_common.ts";

const DEFAULT_MAX_TRANSLATE_HTML_CHARS = 24_000;

export type EntityHtmlMode = "telegram" | "translate";

interface PreservedLeaf {
  text: string;
  entity?:
    | { type: "code" }
    | { type: "pre"; language?: string }
    | { type: "custom_emoji"; custom_emoji_id: string }
    | { type: "text_link"; url: string };
  innerEntities?: MessageEntity[];
}

export interface EntityHtmlContext {
  users: Map<number, MessageEntity.TextMentionMessageEntity["user"]>;
  preservedLeaves: Map<string, PreservedLeaf>;
}

export interface SerializedEntitiesHtml {
  html: string;
  context: EntityHtmlContext;
  hasTranslatableText: boolean;
}

export interface TextWithEntities {
  text: string;
  entities: MessageEntity[];
}

export interface HtmlToEntitiesOptions {
  /**
   * When true, strips spurious horizontal spaces that translation APIs commonly
   * inject around `<br>` tags and inside or around inline HTML tags (such as
   * hyperlinks). Keep false for lossless Telegram HTML round-trips.
   */
  normalizeTranslatedWhitespace?: boolean;
  /**
   * Optional BCP-47 target language code used for language-aware punctuation
   * whitespace rules (e.g. preserving French spacing inside `« »` and before
   * `: ; ! ?`).
   */
  targetLanguage?: string;
}

export function createEntityHtmlContext(): EntityHtmlContext {
  return {
    users: new Map(),
    preservedLeaves: new Map(),
  };
}

const LEAF_ENTITY_TYPES = new Set<MessageEntity["type"]>([
  "code",
  "pre",
  "custom_emoji",
  "mention",
  "hashtag",
  "cashtag",
  "bot_command",
  "url",
  "email",
  "phone_number",
  "bank_card_number",
  "ton_address",
]);

const STYLE_ENTITY_TYPES = new Set<MessageEntity["type"]>([
  "bold",
  "italic",
  "underline",
  "strikethrough",
  "spoiler",
]);

function isAtomicCodeType(type: MessageEntity["type"]): boolean {
  return type === "code" || type === "pre";
}

function isBlockquoteType(type: MessageEntity["type"]): boolean {
  return type === "blockquote" || type === "expandable_blockquote";
}

function isLeafEntity(
  entity: MessageEntity,
  text: string,
  mode: EntityHtmlMode,
): boolean {
  if (
    entity.type === "code" || entity.type === "pre" ||
    entity.type === "custom_emoji"
  ) {
    return true;
  }
  if (mode !== "translate") {
    return false;
  }
  if (LEAF_ENTITY_TYPES.has(entity.type)) {
    return true;
  }
  if (entity.type === "text_link") {
    const slice = text.slice(entity.offset, entity.offset + entity.length);
    return isBareUrlText(slice, entity.url);
  }
  return false;
}

function entityPriority(type: MessageEntity["type"]): number {
  switch (type) {
    case "blockquote":
    case "expandable_blockquote":
      return 0;
    case "pre":
      return 1;
    case "text_link":
    case "text_mention":
      return 2;
    case "bold":
    case "italic":
    case "underline":
    case "strikethrough":
    case "spoiler":
    case "date_time":
      return 3;
    case "code":
    case "custom_emoji":
      return 4;
    default:
      return 5;
  }
}

interface NormalizedEntity {
  entity: MessageEntity;
  start: number;
  end: number;
  isLeaf: boolean;
}

function openTagForEntity(
  entity: MessageEntity,
  ctx: EntityHtmlContext,
): { open: string; close: string } | undefined {
  switch (entity.type) {
    case "bold":
      return { open: "<b>", close: "</b>" };
    case "italic":
      return { open: "<i>", close: "</i>" };
    case "underline":
      return { open: "<u>", close: "</u>" };
    case "strikethrough":
      return { open: "<s>", close: "</s>" };
    case "spoiler":
      return { open: "<tg-spoiler>", close: "</tg-spoiler>" };
    case "blockquote":
      return { open: "<blockquote>", close: "</blockquote>" };
    case "expandable_blockquote":
      return { open: "<blockquote expandable>", close: "</blockquote>" };
    case "text_link":
      return { open: `<a href="${escapeAttr(entity.url)}">`, close: "</a>" };
    case "text_mention":
      ctx.users.set(entity.user.id, entity.user);
      return {
        open: `<a href="tg://user?id=${entity.user.id}">`,
        close: "</a>",
      };
    case "date_time":
      return {
        open: `<tg-time unix="${entity.unix_time}" format="${
          escapeAttr(sanitizeDateTimeFormat(entity.date_time_format))
        }">`,
        close: "</tg-time>",
      };
    case "code":
      return { open: "<code>", close: "</code>" };
    case "pre":
      return entity.language
        ? {
          open: `<pre><code class="language-${escapeAttr(entity.language)}">`,
          close: "</code></pre>",
        }
        : { open: "<pre>", close: "</pre>" };
    case "custom_emoji":
      return {
        open: `<tg-emoji emoji-id="${escapeAttr(entity.custom_emoji_id)}">`,
        close: "</tg-emoji>",
      };
    default:
      return undefined;
  }
}

function renderLeafHtml(
  entity: MessageEntity,
  slice: string,
  mode: EntityHtmlMode,
  ctx: EntityHtmlContext,
  nextLeafId: () => string,
  innerEntities?: MessageEntity[],
): string {
  if (mode === "telegram") {
    const tags = openTagForEntity(entity, ctx);
    if (!tags) return escapeHtmlText(slice, true);
    const body = entity.type === "pre"
      ? (entity.language
        ? escapeHtmlText(slice, true)
        : escapeBarePreHtml(slice))
      : escapeHtmlText(slice, true);
    return `${tags.open}${body}${tags.close}`;
  }

  const id = nextLeafId();
  const extras = innerEntities && innerEntities.length > 0
    ? { innerEntities }
    : {};

  switch (entity.type) {
    case "pre":
      ctx.preservedLeaves.set(id, {
        text: slice,
        entity: {
          type: "pre",
          ...(entity.language !== undefined
            ? { language: entity.language }
            : {}),
        },
      });
      return `<pre id="tg-leaf-${id}" translate="no" class="notranslate" data-tg-leaf="${id}">code</pre>`;
    case "code":
      ctx.preservedLeaves.set(id, { text: slice, entity: { type: "code" } });
      return `<code translate="no" class="notranslate" data-tg-leaf="${id}">${
        escapeHtmlText(slice)
      }</code>`;
    case "custom_emoji":
      ctx.preservedLeaves.set(id, {
        text: slice,
        entity: {
          type: "custom_emoji",
          custom_emoji_id: entity.custom_emoji_id,
        },
        ...extras,
      });
      return `<tg-emoji emoji-id="${
        escapeAttr(entity.custom_emoji_id)
      }" translate="no" class="notranslate" data-tg-leaf="${id}">${
        escapeHtmlText(slice)
      }</tg-emoji>`;
    case "text_link":
      ctx.preservedLeaves.set(id, {
        text: slice,
        entity: { type: "text_link", url: entity.url },
        ...extras,
      });
      return `<a href="${
        escapeAttr(entity.url)
      }" translate="no" class="notranslate" data-tg-leaf="${id}">${
        escapeHtmlText(slice)
      }</a>`;
    default:
      ctx.preservedLeaves.set(id, { text: slice, ...extras });
      return `<span translate="no" class="notranslate" data-tg-leaf="${id}">${
        escapeHtmlText(slice)
      }</span>`;
  }
}

/**
 * Serializes Telegram message text + MessageEntity[] into valid HTML5,
 * handling nested, partially overlapping, and container/leaf-overlapping
 * entities without mutating inputs.
 */
export function entitiesToHtml(
  text: string,
  entities: readonly MessageEntity[] = [],
  options?: { mode?: EntityHtmlMode },
): SerializedEntitiesHtml {
  const mode = options?.mode ?? "telegram";
  const ctx = createEntityHtmlContext();
  let leafCounter = 0;
  const nextLeafId = () => `l${leafCounter++}`;
  let hasTranslatableText = false;

  if (!text) {
    return { html: "", context: ctx, hasTranslatableText: false };
  }

  // Clone & filter valid non-empty entities; never mutate caller's array.
  const normalized: NormalizedEntity[] = [];
  for (const entity of entities) {
    const start = Math.max(0, Math.min(text.length, entity.offset));
    const end = Math.max(
      start,
      Math.min(text.length, entity.offset + entity.length),
    );
    if (end <= start) continue;

    const leaf = isLeafEntity(entity, text, mode);
    if (!leaf && !openTagForEntity(entity, ctx)) {
      // Auto-detected entity (hashtag/mention/url/etc.) in telegram mode needs no tag.
      continue;
    }
    normalized.push({ entity, start, end, isLeaf: leaf });
  }

  // Sort: start asc, length desc (wider outer first), priority asc.
  normalized.sort((a, b) =>
    a.start - b.start ||
    (b.end - b.start) - (a.end - a.start) ||
    entityPriority(a.entity.type) - entityPriority(b.entity.type)
  );

  // Deduplicate overlapping leaf ranges (widest / highest priority wins).
  const leaves: NormalizedEntity[] = [];
  const rawContainers: NormalizedEntity[] = [];

  for (const item of normalized) {
    if (item.isLeaf) {
      const overlapsExistingLeaf = leaves.some(
        (existing) => item.start < existing.end && item.end > existing.start,
      );
      if (!overlapsExistingLeaf) {
        leaves.push(item);
      }
    } else {
      rawContainers.push(item);
    }
  }

  // Reconcile containers against atomic leaves so no container starts or ends
  // strictly inside a leaf. For non-code leaves in translate mode, any partial
  // or inner slice is preserved on the leaf with exact relative offsets.
  const leafInnerEntities = new Map<NormalizedEntity, MessageEntity[]>();
  const validContainers: NormalizedEntity[] = [];

  for (const container of rawContainers) {
    let fragments: { start: number; end: number }[] = [
      { start: container.start, end: container.end },
    ];

    for (const leaf of leaves) {
      const nextFragments: { start: number; end: number }[] = [];
      const atomicCode = isAtomicCodeType(leaf.entity.type);

      for (const frag of fragments) {
        if (frag.end <= leaf.start || frag.start >= leaf.end) {
          nextFragments.push(frag);
          continue;
        }

        if (atomicCode) {
          // Telegram allows blockquotes to wrap enclosed code/pre blocks, but
          // forbids inline formatting entities overlapping code/pre (or partial overlaps).
          if (
            isBlockquoteType(container.entity.type) &&
            frag.start <= leaf.start &&
            frag.end >= leaf.end
          ) {
            nextFragments.push(frag);
            continue;
          }
          if (frag.start < leaf.start) {
            nextFragments.push({ start: frag.start, end: leaf.start });
          }
          if (frag.end > leaf.end) {
            nextFragments.push({ start: leaf.end, end: frag.end });
          }
          continue;
        }

        if (frag.start <= leaf.start && frag.end >= leaf.end) {
          // Container completely wraps this leaf — keep it as an outer HTML tag.
          nextFragments.push(frag);
          continue;
        }

        // Partial overlap or strictly contained inside leaf: split around leaf
        // and preserve the interior slice on the leaf (in translate mode).
        if (frag.start < leaf.start) {
          nextFragments.push({ start: frag.start, end: leaf.start });
        }
        if (mode === "translate") {
          const innerStart = Math.max(frag.start, leaf.start);
          const innerEnd = Math.min(frag.end, leaf.end);
          if (innerEnd > innerStart) {
            const list = leafInnerEntities.get(leaf) ?? [];
            list.push({
              ...container.entity,
              offset: innerStart - leaf.start,
              length: innerEnd - innerStart,
            });
            leafInnerEntities.set(leaf, list);
          }
        }
        if (frag.end > leaf.end) {
          nextFragments.push({ start: leaf.end, end: frag.end });
        }
      }

      fragments = nextFragments;
      if (fragments.length === 0) break;
    }

    for (const frag of fragments) {
      if (frag.end > frag.start) {
        validContainers.push({
          entity: container.entity,
          start: frag.start,
          end: frag.end,
          isLeaf: false,
        });
      }
    }
  }

  validContainers.sort((a, b) =>
    a.start - b.start ||
    (b.end - b.start) - (a.end - a.start) ||
    entityPriority(a.entity.type) - entityPriority(b.entity.type)
  );

  // Enforce non-overlapping blockquotes and split inline containers across
  // blockquote boundaries so inline tags never wrap <blockquote>.
  const keptBlockquotes: NormalizedEntity[] = [];
  const inlineContainers: NormalizedEntity[] = [];

  for (const container of validContainers) {
    if (isBlockquoteType(container.entity.type)) {
      let frags: { start: number; end: number }[] = [
        { start: container.start, end: container.end },
      ];
      for (const bq of keptBlockquotes) {
        const next: { start: number; end: number }[] = [];
        for (const f of frags) {
          if (f.end <= bq.start || f.start >= bq.end) {
            next.push(f);
          } else {
            if (f.start < bq.start) next.push({ start: f.start, end: bq.start });
            if (f.end > bq.end) next.push({ start: bq.end, end: f.end });
          }
        }
        frags = next;
        if (frags.length === 0) break;
      }
      for (const f of frags) {
        if (f.end > f.start) {
          keptBlockquotes.push({
            entity: container.entity,
            start: f.start,
            end: f.end,
            isLeaf: false,
          });
        }
      }
    } else {
      inlineContainers.push(container);
    }
  }

  const finalContainers: NormalizedEntity[] = [...keptBlockquotes];
  for (const container of inlineContainers) {
    let frags: { start: number; end: number }[] = [
      { start: container.start, end: container.end },
    ];
    for (const bq of keptBlockquotes) {
      const next: { start: number; end: number }[] = [];
      for (const f of frags) {
        if (
          f.end <= bq.start ||
          f.start >= bq.end ||
          (f.start >= bq.start && f.end <= bq.end)
        ) {
          next.push(f);
        } else {
          if (f.start < bq.start) next.push({ start: f.start, end: bq.start });
          const innerStart = Math.max(f.start, bq.start);
          const innerEnd = Math.min(f.end, bq.end);
          if (innerEnd > innerStart) {
            next.push({ start: innerStart, end: innerEnd });
          }
          if (f.end > bq.end) next.push({ start: bq.end, end: f.end });
        }
      }
      frags = next;
    }
    for (const f of frags) {
      if (f.end > f.start) {
        finalContainers.push({
          entity: container.entity,
          start: f.start,
          end: f.end,
          isLeaf: false,
        });
      }
    }
  }

  validContainers.length = 0;
  validContainers.push(...finalContainers);
  validContainers.sort((a, b) =>
    a.start - b.start ||
    (b.end - b.start) - (a.end - a.start) ||
    entityPriority(a.entity.type) - entityPriority(b.entity.type)
  );

  // Collect all boundary points where any container or leaf starts/ends.
  const pointSet = new Set<number>([0, text.length]);
  for (const c of validContainers) {
    pointSet.add(c.start);
    pointSet.add(c.end);
  }
  for (const l of leaves) {
    pointSet.add(l.start);
    pointSet.add(l.end);
  }
  const points = Array.from(pointSet).sort((a, b) => a - b);

  // Track open container stack so partially overlapping containers close & reopen cleanly.
  const openStack: { item: NormalizedEntity; close: string }[] = [];
  const out: string[] = [];

  for (let pIdx = 0; pIdx < points.length; pIdx++) {
    const pos = points[pIdx];

    // 1. Close containers ending at `pos` (unwinding & reopening any inner containers).
    let highestEndingIdx = -1;
    for (let i = 0; i < openStack.length; i++) {
      if (openStack[i].item.end === pos) {
        highestEndingIdx = i;
        break;
      }
    }
    if (highestEndingIdx !== -1) {
      const toReopen: NormalizedEntity[] = [];
      while (openStack.length > highestEndingIdx) {
        const popped = openStack.pop()!;
        out.push(popped.close);
        if (popped.item.end > pos) {
          toReopen.push(popped.item);
        }
      }
      toReopen.reverse();
      for (const item of toReopen) {
        const tags = openTagForEntity(item.entity, ctx);
        if (tags) {
          out.push(tags.open);
          openStack.push({ item, close: tags.close });
        }
      }
    }

    if (pos >= text.length) break;

    // 2. Open containers starting at `pos`.
    for (const item of validContainers) {
      if (item.start === pos) {
        const tags = openTagForEntity(item.entity, ctx);
        if (tags) {
          out.push(tags.open);
          openStack.push({ item, close: tags.close });
        }
      }
    }

    const nextPos = points[pIdx + 1];
    if (nextPos === undefined || nextPos <= pos) continue;

    // 3. Emit leaf or prose slice for [pos, nextPos).
    const activeLeaf = leaves.find((l) => l.start <= pos && l.end >= nextPos);
    if (activeLeaf) {
      if (activeLeaf.start === pos) {
        const slice = text.slice(activeLeaf.start, activeLeaf.end);
        const leafHtml = renderLeafHtml(
          activeLeaf.entity,
          slice,
          mode,
          ctx,
          nextLeafId,
          leafInnerEntities.get(activeLeaf),
        );
        out.push(leafHtml);
      }
    } else {
      const slice = text.slice(pos, nextPos);
      if (/\S/.test(slice)) {
        hasTranslatableText = true;
      }
      out.push(escapeHtmlText(slice, mode === "telegram"));
    }
  }

  while (openStack.length > 0) {
    out.push(openStack.pop()!.close);
  }

  return { html: out.join(""), context: ctx, hasTranslatableText };
}

// ============================================================================
// Entity Sanitizer (enforces Telegram Bot API nesting & range invariants)
// ============================================================================

function entitySignature(e: MessageEntity): string {
  switch (e.type) {
    case "pre":
      return `pre:${e.language ?? ""}`;
    case "text_link":
      return `text_link:${e.url}`;
    case "text_mention":
      return `text_mention:${e.user.id}`;
    case "custom_emoji":
      return `custom_emoji:${e.custom_emoji_id}`;
    case "date_time":
      return `date_time:${e.unix_time}:${e.date_time_format}`;
    default:
      return e.type;
  }
}

function sortEntities(entities: MessageEntity[]): MessageEntity[] {
  return entities.sort((a, b) =>
    a.offset - b.offset ||
    b.length - a.length ||
    entityPriority(a.type) - entityPriority(b.type)
  );
}

/**
 * Enforces Telegram Bot API entity invariants:
 * - Clamps all ranges to `[0, textLength]` and drops empty entities.
 * - Ensures `code` and `pre` never overlap or are wrapped by other entities
 *   (splitting wrapping entities cleanly around `code`/`pre`).
 * - Drops nested `blockquote` / `expandable_blockquote` entities.
 * - Merges adjacent identical style entities only when no other entity
 *   crosses the seam (preserving strict tree nesting).
 * - Deduplicates identical entities.
 */
export function sanitizeTelegramEntities(
  textLength: number,
  rawEntities: readonly MessageEntity[],
): MessageEntity[] {
  const clamped: MessageEntity[] = [];
  for (const entity of rawEntities) {
    const start = Math.max(0, Math.min(textLength, entity.offset));
    const end = Math.max(
      start,
      Math.min(textLength, entity.offset + entity.length),
    );
    if (end <= start) continue;
    clamped.push({ ...entity, offset: start, length: end - start });
  }

  sortEntities(clamped);

  // 1. Collect non-overlapping atomic `code` / `pre` ranges.
  const atomicCodeRanges: MessageEntity[] = [];
  const others: MessageEntity[] = [];
  for (const entity of clamped) {
    if (isAtomicCodeType(entity.type)) {
      const start = entity.offset;
      const end = entity.offset + entity.length;
      const overlaps = atomicCodeRanges.some((existing) =>
        start < existing.offset + existing.length && end > existing.offset
      );
      if (!overlaps) {
        atomicCodeRanges.push(entity);
      }
    } else {
      others.push(entity);
    }
  }

  // 2. Split any non-code entity around atomic `code`/`pre` ranges, while
  // allowing blockquotes to wrap fully enclosed `code`/`pre` ranges.
  const splitOthers: MessageEntity[] = [];
  for (const entity of others) {
    let frags: { start: number; end: number }[] = [
      { start: entity.offset, end: entity.offset + entity.length },
    ];
    for (const codeRange of atomicCodeRanges) {
      const cs = codeRange.offset;
      const ce = codeRange.offset + codeRange.length;
      const next: { start: number; end: number }[] = [];
      for (const f of frags) {
        if (f.end <= cs || f.start >= ce) {
          next.push(f);
        } else if (
          isBlockquoteType(entity.type) &&
          f.start <= cs &&
          f.end >= ce
        ) {
          next.push(f);
        } else {
          if (f.start < cs) next.push({ start: f.start, end: cs });
          if (f.end > ce) next.push({ start: ce, end: f.end });
        }
      }
      frags = next;
      if (frags.length === 0) break;
    }
    for (const f of frags) {
      if (f.end > f.start) {
        splitOthers.push({
          ...entity,
          offset: f.start,
          length: f.end - f.start,
        });
      }
    }
  }

  // 3. Enforce no nested or partially overlapping blockquotes (outer/earlier wins,
  // trimming any non-overlapping tail), split inline entities that cross blockquote
  // boundaries so blockquotes are never nested inside inline formatting, and
  // deduplicate exact duplicates.
  const combined = sortEntities([...atomicCodeRanges, ...splitOthers]);
  const keptBlockquotes: { start: number; end: number }[] = [];
  const withoutNestedBlockquotes: MessageEntity[] = [];

  for (const entity of combined) {
    const start = entity.offset;
    const end = entity.offset + entity.length;

    if (isBlockquoteType(entity.type)) {
      let frags: { start: number; end: number }[] = [{ start, end }];
      for (const bq of keptBlockquotes) {
        const next: { start: number; end: number }[] = [];
        for (const f of frags) {
          if (f.end <= bq.start || f.start >= bq.end) {
            next.push(f);
          } else {
            if (f.start < bq.start) next.push({ start: f.start, end: bq.start });
            if (f.end > bq.end) next.push({ start: bq.end, end: f.end });
          }
        }
        frags = next;
        if (frags.length === 0) break;
      }
      for (const f of frags) {
        if (f.end <= f.start) continue;
        keptBlockquotes.push(f);
        withoutNestedBlockquotes.push({
          ...entity,
          offset: f.start,
          length: f.end - f.start,
        });
      }
      continue;
    }
    withoutNestedBlockquotes.push(entity);
  }

  const deduped: MessageEntity[] = [];
  const seen = new Set<string>();

  for (const entity of withoutNestedBlockquotes) {
    if (isBlockquoteType(entity.type) || isAtomicCodeType(entity.type)) {
      const start = entity.offset;
      const end = entity.offset + entity.length;
      const key = `${entitySignature(entity)}@${start}:${end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(entity);
      continue;
    }

    let frags: { start: number; end: number }[] = [
      { start: entity.offset, end: entity.offset + entity.length },
    ];
    for (const bq of keptBlockquotes) {
      const next: { start: number; end: number }[] = [];
      for (const f of frags) {
        if (
          f.end <= bq.start ||
          f.start >= bq.end ||
          (f.start >= bq.start && f.end <= bq.end)
        ) {
          next.push(f);
        } else {
          if (f.start < bq.start) next.push({ start: f.start, end: bq.start });
          const innerStart = Math.max(f.start, bq.start);
          const innerEnd = Math.min(f.end, bq.end);
          if (innerEnd > innerStart) {
            next.push({ start: innerStart, end: innerEnd });
          }
          if (f.end > bq.end) next.push({ start: bq.end, end: f.end });
        }
      }
      frags = next;
    }

    for (const f of frags) {
      if (f.end <= f.start) continue;
      const candidate: MessageEntity = {
        ...entity,
        offset: f.start,
        length: f.end - f.start,
      };
      const key = `${entitySignature(candidate)}@${f.start}:${f.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(candidate);
    }
  }

  // 4. Merge adjacent identical style entities if no other entity crosses the seam.
  const merged: MessageEntity[] = [...deduped];
  let didMerge = true;
  while (didMerge) {
    didMerge = false;
    sortEntities(merged);
    for (let i = 0; i < merged.length; i++) {
      const a = merged[i];
      if (!STYLE_ENTITY_TYPES.has(a.type)) continue;
      const aEnd = a.offset + a.length;

      for (let j = i + 1; j < merged.length; j++) {
        const b = merged[j];
        if (b.offset > aEnd) break;
        if (b.type !== a.type || b.offset !== aEnd) continue;

        const bEnd = b.offset + b.length;
        // Safe to merge iff every other entity that touches the seam either
        // contains the entire merged range [a.offset, bEnd] or is completely
        // inside [a.offset, aEnd] or [aEnd, bEnd] without partially overlapping,
        // and no blockquote starts or ends at the seam.
        const crossesBoundary = merged.some((other, k) => {
          if (k === i || k === j) return false;
          const os = other.offset;
          const oe = other.offset + other.length;
          // Other ends at seam but started before a.offset (would partially overlap merged)
          if (oe === aEnd && os < a.offset) return true;
          // Other starts at seam and ends past bEnd (would partially overlap merged)
          if (os === aEnd && oe > bEnd) return true;
          // Never merge a style entity across a blockquote boundary
          if (
            isBlockquoteType(other.type) &&
            ((oe === aEnd && os >= a.offset) ||
              (os === aEnd && oe <= bEnd))
          ) {
            return true;
          }
          return false;
        });

        if (!crossesBoundary) {
          merged[i] = { ...a, length: bEnd - a.offset };
          merged.splice(j, 1);
          didMerge = true;
          break;
        }
      }
      if (didMerge) break;
    }
  }

  return sortEntities(merged);
}

// ============================================================================
// Deserializer (WHATWG HTML5 DOM via parse5 -> { text, entities })
// ============================================================================

/**
 * Parses HTML5 (including translated/imperfect HTML) via parse5 into plain
 * UTF-16 text and Telegram MessageEntity[] with exact UTF-16 offsets.
 */
export function htmlToTextAndEntities(
  html: string,
  context?: EntityHtmlContext,
  options?: HtmlToEntitiesOptions,
): TextWithEntities {
  const ctx = context ?? createEntityHtmlContext();
  const normalizeWs = options?.normalizeTranslatedWhitespace ?? false;
  const fragment = parseFragment(html);

  const getLeafId = (el: Element): string | undefined => {
    const dataLeafId = getAttr(el, "data-tg-leaf");
    if (dataLeafId) return dataLeafId;
    const htmlId = getAttr(el, "id");
    return htmlId?.startsWith("tg-leaf-")
      ? htmlId.slice("tg-leaf-".length)
      : undefined;
  };

  if (normalizeWs) {
    normalizeTranslatedDomWhitespace(fragment.childNodes, {
      targetLanguage: options?.targetLanguage,
      getPreservedText: (el) => {
        const leafId = getLeafId(el);
        return leafId ? ctx.preservedLeaves.get(leafId)?.text : undefined;
      },
    });
  }

  const textParts: string[] = [];
  let offset = 0;
  const entities: MessageEntity[] = [];
  let pendingBlockBreak = false;
  const flushedBreakOffsets = new Set<number>();

  const endsWithNewline = (): boolean => {
    for (let i = textParts.length - 1; i >= 0; i--) {
      const part = textParts[i];
      if (part.length > 0) return part.endsWith("\n");
    }
    return false;
  };

  const appendRaw = (s: string) => {
    if (!s) return;
    textParts.push(s);
    offset += s.length;
  };

  const flushBlockBreak = (upcomingText?: string) => {
    if (!pendingBlockBreak) return;
    pendingBlockBreak = false;
    if (
      offset > 0 &&
      !endsWithNewline() &&
      !(upcomingText !== undefined && upcomingText.startsWith("\n"))
    ) {
      flushedBreakOffsets.add(offset);
      appendRaw("\n");
    }
  };

  const walk = (nodes: ChildNode[]) => {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];

      if (isTextNode(node)) {
        const val = node.value;
        if (val.length > 0) {
          flushBlockBreak(val);
          appendRaw(val);
        }
        continue;
      }

      if (!isElement(node)) continue;

      const leafId = getLeafId(node);
      if (leafId && ctx.preservedLeaves.has(leafId)) {
        const preserved = ctx.preservedLeaves.get(leafId)!;
        flushBlockBreak(preserved.text);
        const start = offset;
        appendRaw(preserved.text);
        const length = offset - start;
        if (length > 0 && preserved.entity) {
          switch (preserved.entity.type) {
            case "code":
              entities.push({ type: "code", offset: start, length });
              break;
            case "pre":
              entities.push({
                type: "pre",
                offset: start,
                length,
                ...(preserved.entity.language !== undefined
                  ? { language: preserved.entity.language }
                  : {}),
              });
              break;
            case "custom_emoji":
              entities.push({
                type: "custom_emoji",
                custom_emoji_id: preserved.entity.custom_emoji_id,
                offset: start,
                length,
              });
              break;
            case "text_link":
              entities.push({
                type: "text_link",
                url: preserved.entity.url,
                offset: start,
                length,
              });
              break;
          }
        }
        if (preserved.innerEntities) {
          for (const inner of preserved.innerEntities) {
            entities.push({
              ...inner,
              offset: start + inner.offset,
            });
          }
        }
        continue;
      }

      const tag = node.tagName.toLowerCase();

      if (tag === "br") {
        pendingBlockBreak = false;
        appendRaw("\n");
        continue;
      }

      if (tag === "pre") {
        const codeChild = node.childNodes.find(
          (n): n is Element =>
            isElement(n) && n.tagName.toLowerCase() === "code",
        );
        const className = getAttr(codeChild ?? node, "class") ?? "";
        const langMatch = className.match(/(?:^|\s)language-([^\s]+)/);
        const language = langMatch ? langMatch[1] : undefined;
        const raw = getRawTextContent(codeChild ?? node);
        flushBlockBreak(raw);
        const start = offset;
        appendRaw(raw);
        const length = offset - start;
        if (length > 0) {
          entities.push({
            type: "pre",
            offset: start,
            length,
            ...(language ? { language } : {}),
          });
        }
        continue;
      }

      if (tag === "code") {
        const raw = getRawTextContent(node);
        flushBlockBreak(raw);
        const start = offset;
        appendRaw(raw);
        const length = offset - start;
        if (length > 0) {
          entities.push({ type: "code", offset: start, length });
        }
        continue;
      }

      if (tag === "tg-emoji") {
        const emojiId = getAttr(node, "emoji-id");
        const raw = getRawTextContent(node);
        flushBlockBreak(raw);
        const start = offset;
        appendRaw(raw);
        const length = offset - start;
        if (length > 0 && emojiId) {
          entities.push({
            type: "custom_emoji",
            custom_emoji_id: emojiId,
            offset: start,
            length,
          });
        }
        continue;
      }

      if (tag === "p" || tag === "div") {
        if (offset > 0 && !endsWithNewline()) {
          pendingBlockBreak = true;
        }
        const before = offset;
        walk(node.childNodes);
        if (offset > before) {
          pendingBlockBreak = true;
        }
        continue;
      }

      const startBefore = offset;
      walk(node.childNodes);
      const start = flushedBreakOffsets.has(startBefore)
        ? startBefore + 1
        : startBefore;
      const length = offset - start;

      if (length <= 0) continue;

      switch (tag) {
        case "b":
        case "strong":
          entities.push({ type: "bold", offset: start, length });
          break;
        case "i":
        case "em":
          entities.push({ type: "italic", offset: start, length });
          break;
        case "u":
        case "ins":
          entities.push({ type: "underline", offset: start, length });
          break;
        case "s":
        case "strike":
        case "del":
          entities.push({ type: "strikethrough", offset: start, length });
          break;
        case "tg-spoiler":
          entities.push({ type: "spoiler", offset: start, length });
          break;
        case "span": {
          const cls = getAttr(node, "class") ?? "";
          if (cls.split(/\s+/).includes("tg-spoiler")) {
            entities.push({ type: "spoiler", offset: start, length });
          }
          break;
        }
        case "blockquote":
          entities.push({
            type: hasAttr(node, "expandable")
              ? "expandable_blockquote"
              : "blockquote",
            offset: start,
            length,
          });
          break;
        case "a": {
          const href = getAttr(node, "href");
          if (!href) break;
          if (href.startsWith("tg://user?id=")) {
            const userId = parseSafeInt(href.slice("tg://user?id=".length));
            if (userId !== undefined && userId > 0) {
              const user = ctx.users.get(userId) ?? {
                id: userId,
                is_bot: false,
                first_name: textParts.join("").slice(start, start + length),
              };
              entities.push({
                type: "text_mention",
                user,
                offset: start,
                length,
              });
            }
          } else {
            entities.push({
              type: "text_link",
              url: href,
              offset: start,
              length,
            });
          }
          break;
        }
        case "tg-time": {
          const unix = parseSafeInt(getAttr(node, "unix"));
          const format = sanitizeDateTimeFormat(getAttr(node, "format"));
          if (unix !== undefined) {
            entities.push({
              type: "date_time",
              unix_time: unix,
              date_time_format: format,
              offset: start,
              length,
            });
          }
          break;
        }
      }
    }
  };

  walk(fragment.childNodes);

  const text = textParts.join("");
  return {
    text,
    entities: sanitizeTelegramEntities(text.length, entities),
  };
}

function sliceEntitiesForRange(
  entities: readonly MessageEntity[],
  rangeStart: number,
  rangeEnd: number,
): MessageEntity[] {
  const sliced: MessageEntity[] = [];
  for (const entity of entities) {
    const start = Math.max(rangeStart, entity.offset);
    const end = Math.min(rangeEnd, entity.offset + entity.length);
    if (end > start) {
      sliced.push({
        ...entity,
        offset: start - rangeStart,
        length: end - start,
      });
    }
  }
  return sliced;
}

function findSafeEntitySplit(
  text: string,
  entities: readonly MessageEntity[],
  targetPos: number,
): { splitAt: number; sepLen: number } | undefined {
  const leafRanges: { start: number; end: number }[] = [];
  for (const entity of entities) {
    const start = Math.max(0, Math.min(text.length, entity.offset));
    const end = Math.max(
      start,
      Math.min(text.length, entity.offset + entity.length),
    );
    if (end > start && isLeafEntity(entity, text, "translate")) {
      leafRanges.push({ start, end });
    }
  }

  const isInsideLeaf = (pos: number, len = 0): boolean =>
    leafRanges.some((r) =>
      len === 0
        ? pos > r.start && pos < r.end
        : pos < r.end && pos + len > r.start
    );

  const clampedTarget = Math.max(1, Math.min(text.length - 1, targetPos));

  for (const sep of ["\n\n", "\n", " "]) {
    let idx = text.lastIndexOf(sep, clampedTarget);
    while (idx > 0) {
      if (!isInsideLeaf(idx, sep.length)) {
        return { splitAt: idx, sepLen: sep.length };
      }
      idx = text.lastIndexOf(sep, idx - 1);
    }
  }

  // Try snapping around any leaf that covers clampedTarget.
  const coveringLeaf = leafRanges.find(
    (r) => clampedTarget > r.start && clampedTarget < r.end,
  );
  if (coveringLeaf) {
    if (coveringLeaf.start > 0 && !isInsideLeaf(coveringLeaf.start)) {
      return { splitAt: coveringLeaf.start, sepLen: 0 };
    }
    if (coveringLeaf.end < text.length && !isInsideLeaf(coveringLeaf.end)) {
      return { splitAt: coveringLeaf.end, sepLen: 0 };
    }
    return undefined;
  }

  const safePos = adjustSplitForSurrogate(text, clampedTarget);
  if (safePos > 0 && safePos < text.length && !isInsideLeaf(safePos)) {
    return { splitAt: safePos, sepLen: 0 };
  }
  return undefined;
}

/**
 * Translates Telegram message text + entities via HTML5 and deserializes the
 * translated HTML back into plain UTF-16 text and MessageEntity[] using parse5.
 * Automatically splits entity-heavy messages whose serialized HTML exceeds
 * `maxHtmlChars` at safe non-leaf boundaries to stay within API limits.
 */
export async function translateTextAndEntitiesHtml(
  text: string,
  entities: readonly MessageEntity[] | undefined,
  translateHtml: (html: string) => Promise<string>,
  maxHtmlChars = DEFAULT_MAX_TRANSLATE_HTML_CHARS,
  options?: { targetLanguage?: string },
): Promise<TextWithEntities> {
  const sourceEntities = entities ?? [];
  const { html, context, hasTranslatableText } = entitiesToHtml(
    text,
    sourceEntities,
    { mode: "translate" },
  );

  if (!hasTranslatableText) {
    return { text, entities: [...sourceEntities] };
  }

  if (html.length > maxHtmlChars && text.length > 1) {
    const ratioBudget = Math.floor(
      (text.length * maxHtmlChars * 0.75) / Math.max(1, html.length),
    );
    const targetPos = Math.max(
      1,
      Math.min(Math.floor(text.length / 2), ratioBudget),
    );
    const split = findSafeEntitySplit(text, sourceEntities, targetPos);
    if (split && split.splitAt > 0 && split.splitAt < text.length) {
      const rightStart = split.splitAt + split.sepLen;
      const leftText = text.slice(0, split.splitAt);
      const sepText = text.slice(split.splitAt, rightStart);
      const rightText = text.slice(rightStart);

      const leftEntities = sliceEntitiesForRange(
        sourceEntities,
        0,
        split.splitAt,
      );
      const rightEntities = sliceEntitiesForRange(
        sourceEntities,
        rightStart,
        text.length,
      );

      const leftHtmlLen = entitiesToHtml(leftText, leftEntities, {
        mode: "translate",
      }).html.length;
      const rightHtmlLen = entitiesToHtml(rightText, rightEntities, {
        mode: "translate",
      }).html.length;
      const sepHtmlLen = escapeHtmlText(sepText, false).length;
      const duplicatedOverhead = (leftHtmlLen + rightHtmlLen) -
        (html.length - sepHtmlLen);

      if (
        leftHtmlLen < html.length &&
        rightHtmlLen < html.length &&
        duplicatedOverhead < maxHtmlChars
      ) {
        const translatedLeft = await translateTextAndEntitiesHtml(
          leftText,
          leftEntities,
          translateHtml,
          maxHtmlChars,
          options,
        );
        const translatedRight = await translateTextAndEntitiesHtml(
          rightText,
          rightEntities,
          translateHtml,
          maxHtmlChars,
          options,
        );

        const combinedText = translatedLeft.text + sepText +
          translatedRight.text;
        const sepOffset = translatedLeft.text.length;
        const rightOffset = sepOffset + sepText.length;

        // Merge spanning entities (e.g. blockquote, text_link, text_mention, bold)
        // back across the split seam so chunking never fractures a single quote or link,
        // tolerating whitespace inserted/trimmed by translators at the chunk boundary.
        const leftList = [...translatedLeft.entities];
        const rightList = translatedRight.entities.map((e) => ({
          ...e,
          offset: e.offset + rightOffset,
        }));

        const spanningSignatures = new Set<string>();
        for (const e of sourceEntities) {
          if (e.offset < split.splitAt && e.offset + e.length > rightStart) {
            spanningSignatures.add(entitySignature(e));
          }
        }

        const mergedAcrossSeam: MessageEntity[] = [];
        const usedLeft = new Set<number>();
        const usedRight = new Set<number>();

        for (const sig of spanningSignatures) {
          const li = leftList.findIndex(
            (e, idx) =>
              !usedLeft.has(idx) &&
              entitySignature(e) === sig &&
              !/\S/.test(translatedLeft.text.slice(e.offset + e.length)),
          );
          const ri = rightList.findIndex(
            (e, idx) =>
              !usedRight.has(idx) &&
              entitySignature(e) === sig &&
              !/\S/.test(translatedRight.text.slice(0, e.offset - rightOffset)),
          );
          if (li !== -1 && ri !== -1) {
            const leftEnt = leftList[li];
            const rightEnt = rightList[ri];
            usedLeft.add(li);
            usedRight.add(ri);
            mergedAcrossSeam.push({
              ...leftEnt,
              offset: leftEnt.offset,
              length: (rightEnt.offset + rightEnt.length) - leftEnt.offset,
            });
          }
        }

        const combinedEntities: MessageEntity[] = [
          ...leftList.filter((_, idx) => !usedLeft.has(idx)),
          ...rightList.filter((_, idx) => !usedRight.has(idx)),
          ...mergedAcrossSeam,
        ];

        return {
          text: combinedText,
          entities: sanitizeTelegramEntities(
            combinedText.length,
            combinedEntities,
          ),
        };
      }
    }
  }

  const translatedHtml = await translateHtml(html);
  return htmlToTextAndEntities(translatedHtml, context, {
    normalizeTranslatedWhitespace: true,
    targetLanguage: options?.targetLanguage,
  });
}

const PROTECTED_PROSE_ENTITY_TYPES = new Set<MessageEntity["type"]>([
  "code",
  "pre",
  "custom_emoji",
  "url",
  "email",
  "phone_number",
  "hashtag",
  "mention",
  "cashtag",
  "bot_command",
  "bank_card_number",
  "ton_address",
]);

function buildProtectedMask(
  text: string,
  entities: readonly MessageEntity[],
): Uint8Array {
  const mask = new Uint8Array(text.length);
  for (const entity of entities) {
    const isProtected = PROTECTED_PROSE_ENTITY_TYPES.has(entity.type) ||
      (entity.type === "text_link" &&
        isBareUrlText(
          text.slice(entity.offset, entity.offset + entity.length),
          entity.url,
        ));
    if (!isProtected) continue;
    const start = Math.max(0, Math.min(text.length, entity.offset));
    const end = Math.max(
      start,
      Math.min(text.length, entity.offset + entity.length),
    );
    for (let i = start; i < end; i++) {
      mask[i] = 1;
    }
  }
  return mask;
}

/**
 * Removes repeated spaces ("  " -> " ") and leading spaces after newlines ("\n " -> "\n")
 * in prose while preserving all MessageEntity offsets/lengths and skipping code/pre/etc.
 */
export function removeRepeatedSpacesInTextAndEntities(
  text: string,
  entities: readonly MessageEntity[] = [],
): { text: string; entities: MessageEntity[]; changed: boolean } {
  const protectedMask = buildProtectedMask(text, entities);

  const indexMap = new Int32Array(text.length + 1);
  let out = "";
  let prevChar = "";

  for (let i = 0; i < text.length; i++) {
    indexMap[i] = out.length;
    const ch = text[i];
    const dropSpace = ch === " " &&
      protectedMask[i] === 0 &&
      (prevChar === " " || prevChar === "\n");
    if (!dropSpace) {
      out += ch;
      prevChar = ch;
    }
  }
  indexMap[text.length] = out.length;

  if (out === text) {
    return { text, entities: [...entities], changed: false };
  }

  const remapped: MessageEntity[] = [];
  for (const entity of entities) {
    const oldStart = Math.max(0, Math.min(text.length, entity.offset));
    const oldEnd = Math.max(
      oldStart,
      Math.min(text.length, entity.offset + entity.length),
    );
    const newStart = indexMap[oldStart];
    const newEnd = indexMap[oldEnd];
    const newLength = newEnd - newStart;
    if (newLength > 0) {
      remapped.push({ ...entity, offset: newStart, length: newLength });
    }
  }

  return { text: out, entities: remapped, changed: true };
}

/**
 * Fixes typography (e.g. via smartypants) in plain text + MessageEntity[],
 * skipping code/pre/URLs/hashtags/mentions/custom_emoji and accurately
 * remapping every entity offset and length when replacements change length
 * (such as `--` -> `—` or `...` -> `…`).
 */
export function fixPunctuationInTextAndEntities(
  text: string,
  entities: readonly MessageEntity[] = [],
  fixString: (segment: string) => string,
): { text: string; entities: MessageEntity[]; changed: boolean } {
  if (!text) {
    return { text, entities: [...entities], changed: false };
  }

  const protectedMask = buildProtectedMask(text, entities);
  const pointSet = new Set<number>([0, text.length]);
  for (const entity of entities) {
    const start = Math.max(0, Math.min(text.length, entity.offset));
    const end = Math.max(
      start,
      Math.min(text.length, entity.offset + entity.length),
    );
    pointSet.add(start);
    pointSet.add(end);
  }
  const points = Array.from(pointSet).sort((a, b) => a - b);

  const offsetMap = new Map<number, number>();
  let out = "";

  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i];
    const end = points[i + 1];
    offsetMap.set(start, out.length);
    if (end <= start) continue;

    const segment = text.slice(start, end);
    if (protectedMask[start] === 1) {
      out += segment;
      continue;
    }

    const prevChar = start > 0 ? text[start - 1] : "";
    const nextChar = end < text.length ? text[end] : "";
    out += applyTypographyWithContext(segment, prevChar, nextChar, fixString);
  }
  offsetMap.set(text.length, out.length);

  if (out === text) {
    return { text, entities: [...entities], changed: false };
  }

  const remapped: MessageEntity[] = [];
  for (const entity of entities) {
    const oldStart = Math.max(0, Math.min(text.length, entity.offset));
    const oldEnd = Math.max(
      oldStart,
      Math.min(text.length, entity.offset + entity.length),
    );
    const newStart = offsetMap.get(oldStart) ?? 0;
    const newEnd = offsetMap.get(oldEnd) ?? newStart;
    const newLength = newEnd - newStart;
    if (newLength > 0) {
      remapped.push({ ...entity, offset: newStart, length: newLength });
    }
  }

  return { text: out, entities: remapped, changed: true };
}
