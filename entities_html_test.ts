import { assertEquals } from "@std/assert";
import type { MessageEntity } from "grammy/types.ts";
import { smartypantsu } from "smartypants";
import {
  createPlainTextSmartypants,
  translatePlainTextChunks,
  truncateText,
} from "./html_common.ts";
import {
  entitiesToHtml,
  fixPunctuationInTextAndEntities,
  htmlToTextAndEntities,
  removeRepeatedSpacesInTextAndEntities,
  sanitizeTelegramEntities,
  translateTextAndEntitiesHtml,
} from "./entities_html.ts";

Deno.test("entitiesToHtml -> htmlToTextAndEntities round-trips all modern Telegram entities with UTF-16 offsets", () => {
  // Includes non-BMP emoji 👍 (2 UTF-16 code units) to verify exact UTF-16 offsets.
  const text =
    "👍 Bold Italic Under Strike Spoiler\n" +
    "Link1 and Link2 by Pavel at tomorrow\n" +
    "Inline code\n" +
    "const x = 1;\n  const y = 2;\n" +
    "Normal quote\n" +
    "Collapsed quote";

  const entities: MessageEntity[] = [
    { type: "custom_emoji", custom_emoji_id: "5368324170671202286", offset: 0, length: 2 },
    { type: "bold", offset: 3, length: 4 },
    { type: "italic", offset: 8, length: 6 },
    { type: "underline", offset: 15, length: 5 },
    { type: "strikethrough", offset: 21, length: 6 },
    { type: "spoiler", offset: 28, length: 7 },
    { type: "text_link", url: "https://tginfo.me", offset: 36, length: 5 },
    { type: "text_link", url: "https://telegram.org", offset: 46, length: 5 },
    {
      type: "text_mention",
      user: { id: 777, is_bot: false, first_name: "Pavel" },
      offset: 55,
      length: 5,
    },
    {
      type: "date_time",
      unix_time: 1700000000,
      date_time_format: "wDT",
      offset: 64,
      length: 8,
    },
    { type: "code", offset: 80, length: 4 },
    { type: "pre", language: "ts", offset: 85, length: 27 },
    { type: "blockquote", offset: 113, length: 12 },
    { type: "expandable_blockquote", offset: 126, length: 15 },
  ];

  for (const mode of ["telegram", "translate"] as const) {
    const { html, context } = entitiesToHtml(text, entities, { mode });
    const restored = htmlToTextAndEntities(html, context);
    assertEquals(restored.text, text);
    assertEquals(restored.entities, entities);
  }
});

Deno.test("entitiesToHtml handles partially overlapping entities without mutating input", () => {
  const text = "Hello world!";
  const entities: MessageEntity[] = [
    { type: "bold", offset: 0, length: 8 }, // "Hello wo"
    { type: "italic", offset: 6, length: 5 }, // "world"
  ];
  const snapshot = structuredClone(entities);

  const { html, context } = entitiesToHtml(text, entities, {
    mode: "telegram",
  });
  assertEquals(html, "<b>Hello <i>wo</i></b><i>rld</i>!");
  assertEquals(entities, snapshot);

  const restored = htmlToTextAndEntities(html, context);
  assertEquals(restored.text, text);
  assertEquals(restored.entities, [
    { type: "bold", offset: 0, length: 8 },
    { type: "italic", offset: 6, length: 2 },
    { type: "italic", offset: 8, length: 3 },
  ]);
});

Deno.test("translateTextAndEntitiesHtml protects code/pre/hashtags/mentions/custom_emoji and recovers malformed HTML", async () => {
  const text =
    "Check Link1 and Link2 with sendMessage, #betainfo, @tginfo, 👍.\nSecond line\nconst a = 1;";
  const entities: MessageEntity[] = [
    { type: "text_link", url: "https://a.example", offset: 6, length: 5 },
    { type: "text_link", url: "https://b.example", offset: 16, length: 5 },
    { type: "code", offset: 27, length: 11 },
    { type: "hashtag", offset: 40, length: 9 },
    { type: "mention", offset: 51, length: 7 },
    { type: "custom_emoji", custom_emoji_id: "999", offset: 60, length: 2 },
    { type: "pre", language: "js", offset: 76, length: 12 },
  ];

  const translated = await translateTextAndEntitiesHtml(
    text,
    entities,
    (html) => {
      // Simulate Google Translate translating prose, inserting spaces around <br>,
      // adding an unclosed <b> tag, and trying to corrupt translate="no" leaf text.
      const out = html
        .replace("Check ", "<b>Проверьте ")
        .replace("Link1", "Ссылку1")
        .replace(" and ", " и ")
        .replace("Link2", "Ссылку2")
        .replace(" with ", " с ")
        .replace("sendMessage", "CORRUPTED")
        .replace("#betainfo", "#бетаинфо")
        .replace("@tginfo", "@тгинфо")
        .replace("👍", "X")
        .replace(".<br>Second line<br>", ". <br> Вторая строка <br> ")
        .replace(">code</pre>", ">CORRUPTED_PRE</pre>");
      return Promise.resolve(out);
    },
  );

  assertEquals(
    translated.text,
    "Проверьте Ссылку1 и Ссылку2 с sendMessage, #betainfo, @tginfo, 👍.\nВторая строка\nconst a = 1;",
  );

  // Verify exact slices for every entity in translated output!
  const byType = (type: MessageEntity["type"]) =>
    translated.entities.filter((e) => e.type === type);

  assertEquals(byType("text_link").length, 2);
  assertEquals(
    translated.text.slice(
      byType("text_link")[0].offset,
      byType("text_link")[0].offset + byType("text_link")[0].length,
    ),
    "Ссылку1",
  );
  assertEquals(
    translated.text.slice(
      byType("text_link")[1].offset,
      byType("text_link")[1].offset + byType("text_link")[1].length,
    ),
    "Ссылку2",
  );
  assertEquals(
    translated.text.slice(
      byType("code")[0].offset,
      byType("code")[0].offset + byType("code")[0].length,
    ),
    "sendMessage",
  );
  assertEquals(
    translated.text.slice(
      byType("custom_emoji")[0].offset,
      byType("custom_emoji")[0].offset + byType("custom_emoji")[0].length,
    ),
    "👍",
  );
  assertEquals(
    translated.text.slice(
      byType("pre")[0].offset,
      byType("pre")[0].offset + byType("pre")[0].length,
    ),
    "const a = 1;",
  );
  // Unclosed <b> tag was cleanly closed by parse5 and split around code/pre
  // so Telegram's entity nesting rules are respected (no bold overlapping code/pre)!
  const bolds = byType("bold");
  assertEquals(bolds.length, 2);
  const codeEntity = byType("code")[0];
  const preEntity = byType("pre")[0];
  for (const b of bolds) {
    const bEnd = b.offset + b.length;
    assertEquals(
      bEnd <= codeEntity.offset || b.offset >= codeEntity.offset + codeEntity.length,
      true,
    );
    assertEquals(
      bEnd <= preEntity.offset || b.offset >= preEntity.offset + preEntity.length,
      true,
    );
  }
});

Deno.test("translateTextAndEntitiesHtml skips API call when there is no translatable text", async () => {
  let called = false;
  const text = "#betainfo";
  const entities: MessageEntity[] = [
    { type: "hashtag", offset: 0, length: 9 },
  ];

  const res = await translateTextAndEntitiesHtml(text, entities, (html) => {
    called = true;
    return Promise.resolve(html);
  });

  assertEquals(called, false);
  assertEquals(res, { text, entities });
});

Deno.test("removeRepeatedSpacesInTextAndEntities preserves all entities and skips code/pre", () => {
  const text =
    "👍  Hello   world\n  Next line with a   b\n  indented   code";
  const entities: MessageEntity[] = [
    { type: "custom_emoji", custom_emoji_id: "123", offset: 0, length: 2 },
    { type: "bold", offset: 4, length: 13 }, // "Hello   world"
    { type: "expandable_blockquote", offset: 20, length: 20 }, // "Next line with a   b"
    { type: "code", offset: 35, length: 5 }, // "a   b"
    { type: "pre", language: "ts", offset: 41, length: 17 }, // "  indented   code"
  ];

  const res = removeRepeatedSpacesInTextAndEntities(text, entities);
  assertEquals(res.changed, true);
  assertEquals(
    res.text,
    "👍 Hello world\nNext line with a   b\n  indented   code",
  );
  assertEquals(res.entities, [
    { type: "custom_emoji", custom_emoji_id: "123", offset: 0, length: 2 },
    { type: "bold", offset: 3, length: 11 }, // "Hello world"
    { type: "expandable_blockquote", offset: 15, length: 20 }, // "Next line with a   b"
    { type: "code", offset: 30, length: 5 }, // "a   b"
    { type: "pre", language: "ts", offset: 36, length: 17 }, // "  indented   code"
  ]);

  const clean = removeRepeatedSpacesInTextAndEntities("Clean text", []);
  assertEquals(clean.changed, false);
});

Deno.test("entitiesToHtml preserves leading newline in pre and indentation after newline", () => {
  const preText = "\nconst x = 1;";
  const preEntities: MessageEntity[] = [
    { type: "pre", offset: 0, length: preText.length },
  ];
  const preSer = entitiesToHtml(preText, preEntities, { mode: "telegram" });
  const preRestored = htmlToTextAndEntities(preSer.html, preSer.context);
  assertEquals(preRestored, { text: preText, entities: preEntities });

  const indented = "Line 1\n  — indented\nLine 3";
  const indentSer = entitiesToHtml(indented, [], { mode: "telegram" });
  const indentRestored = htmlToTextAndEntities(
    indentSer.html,
    indentSer.context,
  );
  assertEquals(indentRestored, { text: indented, entities: [] });
});

Deno.test("entitiesToHtml handles container/leaf overlaps and enforces Telegram nesting rules", () => {
  // Bold ends inside hashtag leaf
  {
    const text = "Hello #betainfo world";
    const entities: MessageEntity[] = [
      { type: "bold", offset: 0, length: 11 }, // "Hello #beta"
      { type: "hashtag", offset: 6, length: 9 },
    ];
    const ser = entitiesToHtml(text, entities, { mode: "translate" });
    const res = htmlToTextAndEntities(ser.html, ser.context);
    assertEquals(res.text, text);
    assertEquals(res.entities, [{ type: "bold", offset: 0, length: 11 }]);
  }

  // Bold starts inside hashtag leaf
  {
    const text = "#betainfo world";
    const entities: MessageEntity[] = [
      { type: "hashtag", offset: 0, length: 9 },
      { type: "bold", offset: 4, length: 11 }, // "ainfo world"
    ];
    const ser = entitiesToHtml(text, entities, { mode: "translate" });
    const res = htmlToTextAndEntities(ser.html, ser.context);
    assertEquals(res.text, text);
    assertEquals(res.entities, [{ type: "bold", offset: 4, length: 11 }]);
  }

  // Bold strictly inside hashtag leaf (no empty <b></b>)
  {
    const text = "See #betainfo now";
    const entities: MessageEntity[] = [
      { type: "hashtag", offset: 4, length: 9 },
      { type: "bold", offset: 5, length: 4 }, // "beta"
    ];
    const ser = entitiesToHtml(text, entities, { mode: "translate" });
    assertEquals(ser.html.includes("<b></b>"), false);
    const res = htmlToTextAndEntities(ser.html, ser.context);
    assertEquals(res.text, text);
    assertEquals(res.entities, [{ type: "bold", offset: 5, length: 4 }]);
  }

  // Bold wrapping code is split around code
  {
    const text = "Run echo hi now";
    const entities: MessageEntity[] = [
      { type: "bold", offset: 0, length: text.length },
      { type: "code", offset: 4, length: 7 },
    ];
    const ser = entitiesToHtml(text, entities, { mode: "translate" });
    const res = htmlToTextAndEntities(ser.html, ser.context);
    assertEquals(res.text, text);
    assertEquals(res.entities, [
      { type: "bold", offset: 0, length: 4 },
      { type: "code", offset: 4, length: 7 },
      { type: "bold", offset: 11, length: 4 },
    ]);
  }
});

Deno.test("htmlToTextAndEntities rejects empty numeric attributes and inserts block breaks after </p>", () => {
  assertEquals(
    htmlToTextAndEntities(
      `<tg-time unix="" format="bad">now</tg-time> <a href="tg://user?id=">nobody</a>`,
    ),
    { text: "now nobody", entities: [] },
  );
  assertEquals(
    htmlToTextAndEntities(`<p>Hello</p>World`),
    { text: "Hello\nWorld", entities: [] },
  );
  assertEquals(
    htmlToTextAndEntities(
      `<blockquote>outer <blockquote>inner</blockquote></blockquote>`,
    ),
    {
      text: "outer inner",
      entities: [{ type: "blockquote", offset: 0, length: 11 }],
    },
  );
});

Deno.test("fixPunctuationInTextAndEntities remaps entity offsets and skips code/urls", () => {
  const text = 'He said ("hello -- world...") and ran echo "raw" --flag!';
  const entities: MessageEntity[] = [
    { type: "bold", offset: 9, length: 19 }, // '"hello -- world..."'
    { type: "code", offset: 38, length: 17 }, // 'echo "raw" --flag'
    { type: "italic", offset: 55, length: 1 }, // "!"
  ];

  const fixed = fixPunctuationInTextAndEntities(text, entities, smartypantsu);
  assertEquals(fixed.changed, true);
  assertEquals(
    fixed.text,
    'He said (“hello — world…”) and ran echo "raw" --flag!',
  );
  assertEquals(fixed.entities, [
    { type: "bold", offset: 9, length: 16 }, // '“hello — world…”'
    { type: "code", offset: 35, length: 17 }, // 'echo "raw" --flag'
    { type: "italic", offset: 52, length: 1 }, // "!"
  ]);
});

Deno.test("entitiesToHtml and htmlToTextAndEntities preserve code/pre inside blockquotes", async () => {
  const text = "Use sendMessage to post";
  const entities: MessageEntity[] = [
    { type: "blockquote", offset: 0, length: text.length },
    { type: "code", offset: 4, length: 11 },
  ];

  for (const mode of ["telegram", "translate"] as const) {
    const ser = entitiesToHtml(text, entities, { mode });
    const restored = htmlToTextAndEntities(ser.html, ser.context);
    assertEquals(restored, { text, entities });
  }

  const translated = await translateTextAndEntitiesHtml(
    text,
    entities,
    (html) =>
      Promise.resolve(
        html
          .replace("Use ", "Используйте ")
          .replace("sendMessage", "CORRUPTED")
          .replace(" to post", " для публикации"),
      ),
  );
  assertEquals(translated.text, "Используйте sendMessage для публикации");
  assertEquals(translated.entities, [
    { type: "blockquote", offset: 0, length: translated.text.length },
    { type: "code", offset: 12, length: 11 },
  ]);

  // Expandable blockquote containing pre block also stays intact.
  const preText = "Example:\nconst x = 1;";
  const preEntities: MessageEntity[] = [
    { type: "expandable_blockquote", offset: 0, length: preText.length },
    { type: "pre", language: "ts", offset: 9, length: 12 },
  ];
  const preSer = entitiesToHtml(preText, preEntities, { mode: "translate" });
  assertEquals(
    htmlToTextAndEntities(preSer.html, preSer.context),
    { text: preText, entities: preEntities },
  );
});

Deno.test("sanitizeTelegramEntities never wraps blockquotes inside inline styles or merges across blockquote boundaries", () => {
  // Adjacent italic inside and outside blockquote must NOT merge into one italic wrapping blockquote.
  assertEquals(
    htmlToTextAndEntities("<blockquote><i>foo</i></blockquote><i>bar</i>"),
    {
      text: "foobar",
      entities: [
        { type: "blockquote", offset: 0, length: 3 },
        { type: "italic", offset: 0, length: 3 },
        { type: "italic", offset: 3, length: 3 },
      ],
    },
  );

  // Inline bold wrapping a narrower blockquote is split at the blockquote boundary.
  assertEquals(
    htmlToTextAndEntities("<b>Hello <blockquote>world</blockquote></b>"),
    {
      text: "Hello world",
      entities: [
        { type: "bold", offset: 0, length: 6 },
        { type: "blockquote", offset: 6, length: 5 },
        { type: "bold", offset: 6, length: 5 },
      ],
    },
  );

  // Adjacent styles INSIDE the same blockquote still merge cleanly.
  assertEquals(
    htmlToTextAndEntities("<blockquote><i>foo</i><i>bar</i></blockquote>"),
    {
      text: "foobar",
      entities: [
        { type: "blockquote", offset: 0, length: 6 },
        { type: "italic", offset: 0, length: 6 },
      ],
    },
  );
});

Deno.test("htmlToTextAndEntities avoids spurious newlines after </p> for empty tags and leading newlines", () => {
  assertEquals(htmlToTextAndEntities("<p>Hello</p><b></b>"), {
    text: "Hello",
    entities: [],
  });
  assertEquals(htmlToTextAndEntities("<p>Hello</p><b></b>World"), {
    text: "Hello\nWorld",
    entities: [],
  });
  assertEquals(htmlToTextAndEntities("<p>Hello</p><b>\nWorld</b>"), {
    text: "Hello\nWorld",
    entities: [{ type: "bold", offset: 5, length: 6 }],
  });
  assertEquals(htmlToTextAndEntities("<p>Hello</p><b><br>World</b>"), {
    text: "Hello\nWorld",
    entities: [{ type: "bold", offset: 5, length: 6 }],
  });
  assertEquals(htmlToTextAndEntities("<p>Hello</p><b><i>World</i></b>"), {
    text: "Hello\nWorld",
    entities: [
      { type: "italic", offset: 6, length: 5 },
      { type: "bold", offset: 6, length: 5 },
    ],
  });
  // Multiple nested <p> tags inside blockquote/bold after a preceding <p> must not
  // leak the separator newline into the outer entity.
  assertEquals(
    htmlToTextAndEntities(
      "<p>Hello</p><blockquote><p>One</p><p>Two</p></blockquote>",
    ),
    {
      text: "Hello\nOne\nTwo",
      entities: [{ type: "blockquote", offset: 6, length: 7 }],
    },
  );
  assertEquals(
    htmlToTextAndEntities("<p>Hello</p><b><p>One</p><p>Two</p></b>"),
    {
      text: "Hello\nOne\nTwo",
      entities: [{ type: "bold", offset: 6, length: 7 }],
    },
  );
});

Deno.test("sanitizeTelegramEntities trims partially overlapping blockquotes and entitiesToHtml telegram mode keeps literal newlines", () => {
  assertEquals(
    sanitizeTelegramEntities(15, [
      { type: "blockquote", offset: 0, length: 10 },
      { type: "blockquote", offset: 5, length: 10 },
    ]),
    [
      { type: "blockquote", offset: 0, length: 10 },
      { type: "blockquote", offset: 10, length: 5 },
    ],
  );

  const sample = "Line 1\nLine 2";
  const { html, context } = entitiesToHtml(
    sample,
    [{ type: "bold", offset: 0, length: 6 }],
    { mode: "telegram" },
  );
  assertEquals(html, "<b>Line 1</b>\nLine 2");
  assertEquals(html.includes("<br>"), false);
  assertEquals(htmlToTextAndEntities(html, context), {
    text: sample,
    entities: [{ type: "bold", offset: 0, length: 6 }],
  });
});

Deno.test("translateTextAndEntitiesHtml splits oversized entity-heavy HTML at safe boundaries and preserves spanning entities", async () => {
  // Build a short text packed with custom emojis whose HTML expands past maxHtmlChars.
  const parts: string[] = [];
  const entities: MessageEntity[] = [];
  let cursor = 0;
  for (let i = 0; i < 6; i++) {
    if (i > 0) {
      parts.push(" ");
      cursor += 1;
    }
    const emoji = "👍";
    entities.push({
      type: "custom_emoji",
      custom_emoji_id: `9000${i}`,
      offset: cursor,
      length: emoji.length,
    });
    parts.push(emoji);
    cursor += emoji.length;
    const word = ` item${i}`;
    parts.push(word);
    cursor += word.length;
  }
  const text = parts.join("");
  // Add a blockquote and bold spanning the entire message.
  entities.push({ type: "blockquote", offset: 0, length: text.length });
  entities.push({ type: "bold", offset: 0, length: text.length });

  const maxHtmlChars = 350;
  const seenLengths: number[] = [];
  const translated = await translateTextAndEntitiesHtml(
    text,
    entities,
    (html) => {
      seenLengths.push(html.length);
      return Promise.resolve(html.replace(/item(\d)/g, "пункт$1"));
    },
    maxHtmlChars,
  );

  assertEquals(seenLengths.length >= 2, true);
  for (const len of seenLengths) {
    assertEquals(len <= maxHtmlChars, true);
  }
  assertEquals(
    translated.text,
    "👍 пункт0 👍 пункт1 👍 пункт2 👍 пункт3 👍 пункт4 👍 пункт5",
  );
  assertEquals(
    translated.entities.filter((e) => e.type === "custom_emoji").length,
    6,
  );
  assertEquals(
    translated.entities.filter((e) => e.type === "blockquote"),
    [{ type: "blockquote", offset: 0, length: translated.text.length }],
  );
  assertEquals(
    translated.entities.filter((e) => e.type === "bold"),
    [{ type: "bold", offset: 0, length: translated.text.length }],
  );
});

Deno.test("translateTextAndEntitiesHtml seam merge tolerates boundary whitespace and never emits orphaned separator entities", async () => {
  const text = "Hello world ".repeat(10).trim() + "\n\n" +
    "Goodbye world ".repeat(10).trim();
  const entities: MessageEntity[] = [
    { type: "blockquote", offset: 0, length: text.length },
  ];

  // Translator appends trailing space outside </blockquote> on each chunk.
  const merged = await translateTextAndEntitiesHtml(
    text,
    entities,
    (html) => Promise.resolve(`${html} `),
    200,
  );
  assertEquals(
    merged.entities.filter((e) => e.type === "blockquote").length,
    1,
  );

  // Even when translator strips <blockquote> from one chunk, no orphaned
  // blockquote entity is emitted on the "\n\n" separator.
  let call = 0;
  const dropped = await translateTextAndEntitiesHtml(
    text,
    entities,
    (html) => {
      call++;
      return Promise.resolve(
        call === 2 ? html.replace(/<\/?blockquote>/g, "") : html,
      );
    },
    200,
  );
  const quotes = dropped.entities.filter((e) => e.type === "blockquote");
  for (const q of quotes) {
    assertEquals(
      dropped.text.slice(q.offset, q.offset + q.length).trim().length > 0,
      true,
    );
  }
});

Deno.test("htmlToTextAndEntities strips auto-inserted leading newline inside tags wrapping <p> and ignores class='notranslate' on <pre>", async () => {
  assertEquals(
    htmlToTextAndEntities("Intro<blockquote><p>First</p><p>Second</p></blockquote>"),
    {
      text: "Intro\nFirst\nSecond",
      entities: [{ type: "blockquote", offset: 6, length: 12 }],
    },
  );
  // Explicit <br> inside an entity is preserved.
  assertEquals(
    htmlToTextAndEntities("<b><br>Hello</b>"),
    {
      text: "\nHello",
      entities: [{ type: "bold", offset: 0, length: 6 }],
    },
  );
  // Stripped data-tg-leaf on <pre> still recovers via id="tg-leaf-...".
  const codeText = "Run:\nconst x = 1;";
  const codeEntities: MessageEntity[] = [
    { type: "pre", language: "ts", offset: 5, length: 12 },
  ];
  const recovered = await translateTextAndEntitiesHtml(
    codeText,
    codeEntities,
    (html) => Promise.resolve(html.replace(/\s*data-tg-leaf="[^"]*"/g, "")),
  );
  assertEquals(recovered, { text: codeText, entities: codeEntities });

  // Bare <pre class="notranslate"> without language-* never sets language: "notranslate".
  assertEquals(
    htmlToTextAndEntities('<pre class="notranslate">hello</pre>'),
    {
      text: "hello",
      entities: [{ type: "pre", offset: 0, length: 5 }],
    },
  );
});

Deno.test("entitiesToHtml telegram mode never wraps <blockquote> inside inline tags", () => {
  const { html, context } = entitiesToHtml(
    "Hello world",
    [
      { type: "bold", offset: 0, length: 11 },
      { type: "blockquote", offset: 0, length: 5 },
    ],
    { mode: "telegram" },
  );
  assertEquals(html, "<blockquote><b>Hello</b></blockquote><b> world</b>");
  assertEquals(htmlToTextAndEntities(html, context), {
    text: "Hello world",
    entities: [
      { type: "blockquote", offset: 0, length: 5 },
      { type: "bold", offset: 0, length: 5 },
      { type: "bold", offset: 5, length: 6 },
    ],
  });
});

Deno.test("createPlainTextSmartypants preserves backslash-escaped punctuation without emitting HTML entities", () => {
  const fix = createPlainTextSmartypants(smartypantsu);
  const res = fixPunctuationInTextAndEntities(
    'Keep \\" \\\' \\- \\. \\` \\\\ and &#34; but fix "hello" -- world...',
    [],
    fix,
  );
  assertEquals(res.changed, true);
  assertEquals(
    res.text,
    'Keep \\" \\\' \\- \\. \\` \\\\ and &#34; but fix “hello” — world…',
  );
});

Deno.test("htmlToTextAndEntities ignores empty trailing/nested <p> and <div> without emitting spurious newlines", () => {
  assertEquals(htmlToTextAndEntities("<p>First</p><p></p>"), {
    text: "First",
    entities: [],
  });
  assertEquals(htmlToTextAndEntities("First<div></div>"), {
    text: "First",
    entities: [],
  });
  assertEquals(htmlToTextAndEntities("<p>First</p><p><b></b></p>Second"), {
    text: "First\nSecond",
    entities: [],
  });
  assertEquals(htmlToTextAndEntities("First<b><p>Second</p></b><p></p>"), {
    text: "First\nSecond",
    entities: [{ type: "bold", offset: 6, length: 6 }],
  });
});

Deno.test("truncateText avoids splitting UTF-16 surrogate pairs and respects maxLength", () => {
  assertEquals(truncateText("short", 10), "short");
  // Emoji 👍 is 2 UTF-16 code units at indices 4..5; cutting at 8-3=5 would split it.
  const withEmoji = "abcd👍efgh";
  const truncated = truncateText(withEmoji, 8);
  assertEquals(truncated, "abcd...");
  assertEquals(truncated.length <= 8, true);

  // Tiny maxLength <= 3 never splits a surrogate pair either.
  assertEquals(truncateText("👍abc", 1), "");
  assertEquals(truncateText("👍abc", 2), "👍");
  assertEquals(truncateText("abc", 0), "");
});

Deno.test("translatePlainTextChunks skips empty/whitespace-only inputs and separator chunks", async () => {
  let calls = 0;
  const emptyRes = await translatePlainTextChunks("", () => {
    calls++;
    return Promise.resolve([""]);
  });
  assertEquals(emptyRes, "");
  assertEquals(calls, 0);

  const wsRes = await translatePlainTextChunks("   \n\n\t ", () => {
    calls++;
    return Promise.resolve([""]);
  });
  assertEquals(wsRes, "   \n\n\t ");
  assertEquals(calls, 0);

  const sentBatches: string[][] = [];
  const input = "a".repeat(10) + "   " + "b".repeat(10);
  const translated = await translatePlainTextChunks(
    input,
    (contents) => {
      sentBatches.push(contents);
      return Promise.resolve(contents.map((c) => c.toUpperCase()));
    },
    10,
  );
  assertEquals(sentBatches, [["aaaaaaaaaa", "bbbbbbbbbb"]]);
  assertEquals(translated, "AAAAAAAAAA   BBBBBBBBBB");
});

Deno.test("translateTextAndEntitiesHtml stops splitting when spanning entity overhead exceeds maxHtmlChars", async () => {
  const text = "Click here now";
  const url = "https://example.com/" + "a".repeat(300);
  const entities: MessageEntity[] = [
    { type: "text_link", url, offset: 0, length: text.length },
  ];

  const calls: string[] = [];
  const res = await translateTextAndEntitiesHtml(
    text,
    entities,
    (html) => {
      calls.push(html);
      return Promise.resolve(html.replace("Click here now", "Нажмите здесь"));
    },
    100,
  );

  assertEquals(calls.length, 1);
  assertEquals(res, {
    text: "Нажмите здесь",
    entities: [{ type: "text_link", url, offset: 0, length: 13 }],
  });
});
