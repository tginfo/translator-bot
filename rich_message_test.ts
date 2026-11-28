import { assertEquals, assertStringIncludes } from "@std/assert";
import type { RichMessage, RichText } from "grammy/types.ts";
import { smartypantsu } from "smartypants";
import {
  createPlainTextSmartypants,
  splitTextPreservingSeparators,
} from "./html_common.ts";
import {
  extractRichMessageHashtags,
  fixPunctuationInRichMessage,
  htmlToInputRichMessage,
  plainTextToRichMessage,
  plainTextToRichMessages,
  removeRepeatedSpacesInRichMessage,
  richMessageToHtml,
  richMessageToPlainText,
  richMessageToTranslatableHtmlDocuments,
  richTextToPlainText,
  sanitizeButtonRichText,
  toInputRichMessage,
  translateRichMessageHtml,
} from "./rich_message.ts";

function buildFullRichMessage(): RichMessage {
  return {
    is_rtl: true,
    blocks: [
      { type: "anchor", name: "top" },
      { type: "heading", size: 2, text: "Release Notes" },
      {
        type: "paragraph",
        text: [
          "Hello ",
          { type: "bold", text: "world" },
          ", ",
          { type: "italic", text: "italic" },
          ", ",
          { type: "underline", text: "under" },
          ", ",
          { type: "strikethrough", text: "strike" },
          ", ",
          { type: "spoiler", text: "secret" },
          ", ",
          { type: "marked", text: "mark" },
          ", H",
          { type: "subscript", text: "2" },
          "O, x",
          { type: "superscript", text: "2" },
          ".",
        ],
      },
      { type: "pre", language: "ts", text: "const x = 1;\n  const y = 2;" },
      { type: "footer", text: "Footer text" },
      { type: "divider" },
      { type: "mathematical_expression", expression: "E = mc^2" },
      {
        type: "list",
        items: [
          {
            label: "1.",
            value: 1,
            type: "1",
            blocks: [{ type: "paragraph", text: "First item" }],
          },
          {
            label: "2.",
            value: 2,
            type: "1",
            blocks: [
              { type: "paragraph", text: "Second item" },
              {
                type: "list",
                items: [
                  {
                    label: "",
                    has_checkbox: true,
                    is_checked: true,
                    blocks: [{ type: "paragraph", text: "Done task" }],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        type: "blockquote",
        blocks: [{ type: "paragraph", text: "Quote body" }],
        credit: "Author",
      },
      {
        type: "expandable_blockquote",
        blocks: [{ type: "paragraph", text: "Long quote" }],
      },
      { type: "pullquote", text: "Pull quote", credit: "Someone" },
      {
        type: "photo",
        photo: [
          { file_id: "small_id", file_unique_id: "u1", width: 100, height: 100 },
          { file_id: "large_id", file_unique_id: "u2", width: 1200, height: 800 },
        ],
        has_spoiler: true,
        caption: { text: "Photo caption", credit: "Photographer" },
      },
      {
        type: "video",
        video: {
          file_id: "vid_id",
          file_unique_id: "vu1",
          width: 1920,
          height: 1080,
          duration: 30,
          start_timestamp: 5,
          cover: [
            { file_id: "cov_small", file_unique_id: "cu1", width: 100, height: 60 },
            { file_id: "cov_large", file_unique_id: "cu2", width: 640, height: 360 },
          ],
        },
        has_spoiler: true,
        caption: { text: "Video caption" },
      },
      {
        type: "animation",
        animation: {
          file_id: "anim_id",
          file_unique_id: "au1",
          width: 320,
          height: 240,
          duration: 4,
        },
      },
      {
        type: "audio",
        audio: {
          file_id: "audio_id",
          file_unique_id: "mu1",
          duration: 180,
          performer: "Artist",
          title: "Track",
        },
      },
      {
        type: "document",
        document: {
          file_id: "doc_id",
          file_unique_id: "du1",
          file_name: "report.pdf",
        },
      },
      {
        type: "voice_note",
        voice_note: {
          file_id: "voice_id",
          file_unique_id: "vnu1",
          duration: 12,
        },
      },
      {
        type: "collage",
        blocks: [
          {
            type: "photo",
            photo: [
              { file_id: "c_img", file_unique_id: "ci1", width: 500, height: 500 },
            ],
          },
        ],
        caption: { text: "Collage caption" },
      },
      {
        type: "slideshow",
        blocks: [
          {
            type: "photo",
            photo: [
              { file_id: "s_img", file_unique_id: "si1", width: 500, height: 500 },
            ],
          },
        ],
      },
      {
        type: "table",
        is_bordered: true,
        is_striped: true,
        is_compact: true,
        caption: "Metrics",
        cells: [
          [
            { text: "Name", is_header: true, align: "left", valign: "middle" },
            { text: "Value", is_header: true, align: "right", valign: "middle" },
          ],
          [
            { text: "Speed", colspan: 2, align: "center", valign: "top" },
            { align: "left", valign: "top" },
          ],
        ],
      },
      {
        type: "details",
        summary: "More info",
        is_open: true,
        blocks: [{ type: "paragraph", text: "Hidden details" }],
      },
      {
        type: "map",
        location: { latitude: 41.9, longitude: 12.5 },
        zoom: 14,
        width: 600,
        height: 400,
        caption: { text: "Rome" },
      },
      {
        type: "buttons",
        align: "center",
        buttons: [{ text: "Open", url: "https://tginfo.me", style: "primary" }],
      },
    ],
  };
}

Deno.test("toInputRichMessage converts all block types and preserves metadata", () => {
  const richMessage = buildFullRichMessage();
  const input = toInputRichMessage(richMessage);

  assertEquals(input.is_rtl, true);
  assertEquals(input.blocks?.length, richMessage.blocks.length);

  const listBlock = input.blocks?.[7];
  assertEquals(listBlock?.type, "list");
  if (listBlock?.type === "list") {
    assertEquals("label" in listBlock.items[0], false);
    assertEquals(listBlock.items[0].value, 1);
  }

  assertEquals(input.blocks?.[11], {
    type: "photo",
    photo: { type: "photo", media: "large_id", has_spoiler: true },
    caption: { text: "Photo caption", credit: "Photographer" },
  });

  assertEquals(input.blocks?.[12], {
    type: "video",
    video: {
      type: "video",
      media: "vid_id",
      width: 1920,
      height: 1080,
      duration: 30,
      cover: "cov_large",
      start_timestamp: 5,
      has_spoiler: true,
    },
    caption: { text: "Video caption" },
  });
});

Deno.test("richMessageToHtml -> htmlToInputRichMessage round-trips every block type losslessly", () => {
  const richMessage = buildFullRichMessage();
  const expected = toInputRichMessage(richMessage);

  for (const mode of ["telegram", "translate"] as const) {
    const { html, context } = richMessageToHtml(richMessage, { mode });
    const roundTripped = htmlToInputRichMessage(html, context);
    assertEquals(roundTripped, expected);
  }
});

Deno.test("richMessageToHtml -> htmlToInputRichMessage round-trips all inline RichText entities", () => {
  const richMessage: RichMessage = {
    blocks: [
      {
        type: "paragraph",
        text: [
          { type: "anchor", name: "intro" },
          "See ",
          { type: "url", url: "https://tginfo.me", text: "TGInfo" },
          " (",
          { type: "url", url: "https://tginfo.me", text: "https://tginfo.me" },
          "), mail ",
          {
            type: "email_address",
            email_address: "hi@tginfo.me",
            text: "support",
          },
          ", call ",
          { type: "phone_number", phone_number: "+123456789", text: "hotline" },
          ", ping ",
          {
            type: "text_mention",
            user: { id: 42, is_bot: false, first_name: "Pavel" },
            text: "Pavel",
          },
          " at ",
          {
            type: "date_time",
            unix_time: 1700000000,
            date_time_format: "wDT",
            text: "tomorrow",
          },
          " ",
          {
            type: "custom_emoji",
            custom_emoji_id: "5368324170671202286",
            alternative_text: "👍",
          },
          " with ",
          { type: "code", text: "sendRichMessage()" },
          " and ",
          { type: "mathematical_expression", expression: "x^2 + y^2" },
          " ",
          { type: "mention", username: "tginfo", text: "@tginfo" },
          " ",
          { type: "hashtag", hashtag: "betainfo", text: "#betainfo" },
          " ",
          { type: "cashtag", cashtag: "TON", text: "$TON" },
          " ",
          { type: "bot_command", bot_command: "/start", text: "/start" },
          " ",
          { type: "anchor_link", anchor_name: "intro", text: "back up" },
          " ",
          { type: "reference_link", reference_name: "note1", text: "[1]" },
          " ",
          { type: "reference", name: "note1", text: "Footnote" },
          " ",
          {
            type: "button",
            button: {
              text: "Tap",
              callback_data: "cb_1",
              style: "success",
            },
          },
        ],
      },
    ],
  };

  const { html, context } = richMessageToHtml(richMessage, {
    mode: "translate",
  });
  const restored = htmlToInputRichMessage(html, context);
  assertEquals(restored, toInputRichMessage(richMessage));
});

Deno.test("htmlToInputRichMessage parses standalone Telegram Rich HTML without context", () => {
  const rawHtml = `
    <h1>Main Title</h1>
    <p>Hello <b>bold</b> and <tg-spoiler>hidden</tg-spoiler> with <tg-emoji emoji-id="999">🔥</tg-emoji> and <tg-math>a+b</tg-math>.</p>
    <p>Jump to <a href="#ref1">note</a> or <a href="mailto:test@example.com">email</a>.</p>
    <p><tg-reference name="ref1">Note body</tg-reference></p>
    <pre><code class="language-python">print("hi")</code></pre>
    <ul>
      <li><input type="checkbox" checked> Done item</li>
      <li><input type="checkbox"> Todo item</li>
    </ul>
    <ol start="3" type="a">
      <li>Alpha</li>
      <li value="7" type="i">Roman</li>
    </ol>
    <blockquote expandable><p>Quoted line</p><cite>Author</cite></blockquote>
    <aside>Pull quote<cite>Editor</cite></aside>
    <table bordered compact>
      <caption>Stats</caption>
      <tr><th align="left">Key</th><th align="right">Val</th></tr>
      <tr><td colspan="2" align="center" valign="middle">100</td></tr>
    </table>
    <details open><summary>Show</summary><p>Inside</p></details>
    <figure><tg-map lat="41.9" long="12.5" zoom="14"></tg-map><figcaption>Rome<cite>Maps</cite></figcaption></figure>
    <tg-button-row align="right"><tg-button type="url" style="primary" url="https://t.me">Open</tg-button></tg-button-row>
    <hr>
  `;

  const parsed = htmlToInputRichMessage(rawHtml);
  assertEquals(parsed.blocks?.length, 14);
  assertEquals(parsed.blocks?.[0], {
    type: "heading",
    size: 1,
    text: "Main Title",
  });
  assertEquals(parsed.blocks?.[2], {
    type: "paragraph",
    text: [
      "Jump to ",
      { type: "reference_link", reference_name: "ref1", text: "note" },
      " or ",
      {
        type: "email_address",
        email_address: "test@example.com",
        text: "email",
      },
      ".",
    ],
  });
  assertEquals(parsed.blocks?.[4], {
    type: "pre",
    language: "python",
    text: 'print("hi")',
  });
  assertEquals(parsed.blocks?.[5], {
    type: "list",
    items: [
      {
        has_checkbox: true,
        is_checked: true,
        blocks: [{ type: "paragraph", text: "Done item" }],
      },
      {
        has_checkbox: true,
        blocks: [{ type: "paragraph", text: "Todo item" }],
      },
    ],
  });
  assertEquals(parsed.blocks?.[6], {
    type: "list",
    items: [
      { value: 3, type: "a", blocks: [{ type: "paragraph", text: "Alpha" }] },
      { value: 7, type: "i", blocks: [{ type: "paragraph", text: "Roman" }] },
    ],
  });
  assertEquals(parsed.blocks?.[7], {
    type: "expandable_blockquote",
    blocks: [{ type: "paragraph", text: "Quoted line" }],
    credit: "Author",
  });
  assertEquals(parsed.blocks?.[8], {
    type: "pullquote",
    text: "Pull quote",
    credit: "Editor",
  });
  assertEquals(parsed.blocks?.[11], {
    type: "map",
    location: { latitude: 41.9, longitude: 12.5 },
    zoom: 14,
    caption: { text: "Rome", credit: "Maps" },
  });
  assertEquals(parsed.blocks?.[12], {
    type: "buttons",
    align: "right",
    buttons: [{ text: "Open", url: "https://t.me", style: "primary" }],
  });
  assertEquals(parsed.blocks?.[13], { type: "divider" });
});

Deno.test("translateRichMessageHtml sends entire article as ONE HTML document for full LLM context", async () => {
  const richMessage: RichMessage = {
    blocks: [
      { type: "heading", size: 1, text: "Telegram Update" },
      {
        type: "paragraph",
        text: [
          "Read ",
          { type: "bold", text: { type: "url", url: "https://tginfo.me", text: "our blog" } },
          " with ",
          { type: "code", text: "sendRichMessage" },
          " and ",
          { type: "hashtag", text: "#betainfo", hashtag: "betainfo" },
          ".\nSecond line.",
        ],
      },
      { type: "pre", language: "js", text: "console.log('keep verbatim');" },
      { type: "mathematical_expression", expression: "a^2 + b^2 = c^2" },
      {
        type: "table",
        caption: "Metrics",
        cells: [[{ text: "Speed", align: "left", valign: "top" }]],
      },
      {
        type: "photo",
        photo: [{ file_id: "img1", file_unique_id: "u1", width: 800, height: 600 }],
        caption: { text: "Screenshot", credit: "TGInfo" },
      },
      {
        type: "buttons",
        buttons: [{ text: "Open", url: "https://tginfo.me" }],
      },
    ],
  };

  let capturedDocs: string[] = [];
  const translated = await translateRichMessageHtml(richMessage, (docs) => {
    capturedDocs = docs;
    // Simulate Google Cloud Translate translating prose across the single HTML document,
    // adding spaces around <br>, and even corrupting inner text of translate="no" spans/blocks.
    const translatedDoc = docs[0]
      .replace("Telegram Update", "Обновление Telegram")
      .replace("Read ", "Читайте ")
      .replace("our blog", "наш блог")
      .replace(" with ", " с ")
      .replace(" and ", " и ")
      .replace("sendRichMessage", "CORRUPTED_CODE")
      .replace("#betainfo", "#бетаинфо")
      .replace(".<br>Second line.", ". <br> Вторая строка.")
      .replace(">code</pre>", ">CORRUPTED_PRE</pre>")
      .replace(">formula</tg-math-block>", ">CORRUPTED_MATH</tg-math-block>")
      .replace("Metrics", "Метрики")
      .replace("Speed", "Скорость")
      .replace("Screenshot", "Скриншот")
      .replace("Open", "Открыть");
    return Promise.resolve([translatedDoc]);
  });

  // Entire multi-block article MUST be sent in ONE single HTML document string!
  assertEquals(capturedDocs.length, 1);
  assertStringIncludes(capturedDocs[0], "<h1>Telegram Update</h1>");
  assertStringIncludes(capturedDocs[0], "<table>");
  assertStringIncludes(capturedDocs[0], "<figure");

  assertEquals(translated.blocks?.[0], {
    type: "heading",
    size: 1,
    text: "Обновление Telegram",
  });
  assertEquals(translated.blocks?.[1], {
    type: "paragraph",
    text: [
      "Читайте ",
      { type: "bold", text: { type: "url", url: "https://tginfo.me", text: "наш блог" } },
      " с ",
      { type: "code", text: "sendRichMessage" },
      " и ",
      { type: "hashtag", text: "#betainfo", hashtag: "betainfo" },
      ".\nВторая строка.",
    ],
  });
  // Code & math blocks are restored 100% verbatim!
  assertEquals(translated.blocks?.[2], {
    type: "pre",
    language: "js",
    text: "console.log('keep verbatim');",
  });
  assertEquals(translated.blocks?.[3], {
    type: "mathematical_expression",
    expression: "a^2 + b^2 = c^2",
  });
  assertEquals(translated.blocks?.[4], {
    type: "table",
    caption: "Метрики",
    cells: [[{ text: "Скорость", align: "left", valign: "top" }]],
  });
  assertEquals(translated.blocks?.[5], {
    type: "photo",
    photo: { type: "photo", media: "img1" },
    caption: { text: "Скриншот", credit: "TGInfo" },
  });
  assertEquals(translated.blocks?.[6], {
    type: "buttons",
    buttons: [{ text: "Открыть", url: "https://tginfo.me" }],
  });
});

Deno.test("richMessageToTranslatableHtmlDocuments splits only when exceeding maxDocChars and skips non-prose articles", async () => {
  const nonProse: RichMessage = {
    blocks: [
      { type: "pre", text: "const a = 1;" },
      { type: "divider" },
      {
        type: "photo",
        photo: [{ file_id: "p1", file_unique_id: "u1", width: 100, height: 100 }],
      },
    ],
  };

  let called = false;
  const skippedResult = await translateRichMessageHtml(nonProse, (docs) => {
    called = true;
    return Promise.resolve(docs);
  });
  assertEquals(called, false);
  assertEquals(skippedResult, toInputRichMessage(nonProse));

  const longArticle: RichMessage = {
    blocks: [
      { type: "paragraph", text: "A".repeat(120) },
      { type: "paragraph", text: "B".repeat(120) },
      { type: "paragraph", text: "C".repeat(120) },
    ],
  };
  const { documents } = richMessageToTranslatableHtmlDocuments(
    longArticle,
    260,
  );
  // Blocks 0+1 (~255 chars) stay in doc 0, block 2 goes to doc 1
  assertEquals(documents.length, 2);
});

Deno.test("extractRichMessageHashtags finds hashtags across nested blocks", () => {
  const richMessage: RichMessage = {
    blocks: [
      {
        type: "heading",
        size: 1,
        text: [
          "Update ",
          { type: "hashtag", text: "#betainfo", hashtag: "betainfo" },
        ],
      },
      {
        type: "blockquote",
        blocks: [
          {
            type: "paragraph",
            text: [{ type: "hashtag", text: "#Ad", hashtag: "#Ad" }],
          },
        ],
      },
      {
        type: "details",
        summary: "Tags",
        blocks: [
          {
            type: "list",
            items: [
              {
                label: "•",
                blocks: [
                  {
                    type: "paragraph",
                    text: [
                      "Sponsored ",
                      { type: "hashtag", text: "#реклама", hashtag: "реклама" },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        type: "photo",
        photo: [{ file_id: "p1", file_unique_id: "u1", width: 10, height: 10 }],
        caption: {
          text: [{ type: "hashtag", text: "#promo", hashtag: "promo" }],
        },
      },
    ],
  };

  assertEquals(extractRichMessageHashtags(richMessage), [
    "#betainfo",
    "#Ad",
    "#реклама",
    "#promo",
  ]);
});

Deno.test("sanitizeButtonRichText restricts button text to plain text, custom_emoji, and date_time", () => {
  const dirty: RichText = [
    { type: "bold", text: "Click " },
    {
      type: "custom_emoji",
      custom_emoji_id: "123",
      alternative_text: "🔥",
    },
    " ",
    {
      type: "date_time",
      unix_time: 1700000000,
      date_time_format: "t",
      text: { type: "italic", text: "now" },
    },
  ];

  assertEquals(sanitizeButtonRichText(dirty), [
    "Click ",
    {
      type: "custom_emoji",
      custom_emoji_id: "123",
      alternative_text: "🔥",
    },
    " ",
    {
      type: "date_time",
      unix_time: 1700000000,
      date_time_format: "t",
      text: "now",
    },
  ]);
});

Deno.test("removeRepeatedSpacesInRichMessage cleans prose while skipping code and pre blocks", () => {
  const richMessage: RichMessage = {
    blocks: [
      {
        type: "paragraph",
        text: [
          "Hello   world\n Next  ",
          { type: "bold", text: " line" },
          " with ",
          { type: "code", text: "a   b" },
        ],
      },
      { type: "pre", text: "  indented   code" },
    ],
  };

  const { richMessage: cleaned, changed } = removeRepeatedSpacesInRichMessage(
    richMessage,
  );
  assertEquals(changed, true);
  assertEquals(cleaned.blocks?.[0], {
    type: "paragraph",
    text: [
      "Hello world\nNext ",
      { type: "bold", text: "line" },
      " with ",
      { type: "code", text: "a   b" },
    ],
  });
  assertEquals(cleaned.blocks?.[1], {
    type: "pre",
    text: "  indented   code",
  });

  const unchanged = removeRepeatedSpacesInRichMessage({
    blocks: [{ type: "paragraph", text: "Already clean." }],
  });
  assertEquals(unchanged.changed, false);
});

Deno.test("fixPunctuationInRichMessage fixes typography including across formatting boundaries", () => {
  const richMessage: RichMessage = {
    blocks: [
      {
        type: "paragraph",
        text: [
          'He said "',
          { type: "italic", text: "hello -- world..." },
          '" and ran ',
          { type: "code", text: 'echo "raw" --flag' },
        ],
      },
      { type: "pre", text: 'const s = "keep -- raw...";' },
    ],
  };

  const { richMessage: fixed, changed } = fixPunctuationInRichMessage(
    richMessage,
    smartypantsu,
  );
  assertEquals(changed, true);
  assertEquals(fixed.blocks?.[0], {
    type: "paragraph",
    text: [
      "He said “",
      { type: "italic", text: "hello — world…" },
      "” and ran ",
      { type: "code", text: 'echo "raw" --flag' },
    ],
  });
  assertEquals(fixed.blocks?.[1], {
    type: "pre",
    text: 'const s = "keep -- raw...";',
  });
});

Deno.test("richMessageToPlainText and plainTextToRichMessage handle long fallback articles", () => {
  const richMessage: RichMessage = {
    blocks: [
      { type: "heading", size: 1, text: "Title" },
      {
        type: "paragraph",
        text: [
          "Hello ",
          { type: "custom_emoji", custom_emoji_id: "1", alternative_text: "👋" },
        ],
      },
      {
        type: "list",
        items: [
          {
            label: "",
            has_checkbox: true,
            is_checked: true,
            blocks: [{ type: "paragraph", text: "Checked" }],
          },
        ],
      },
    ],
  };

  const paragraph = richMessage.blocks[1];
  assertEquals(paragraph.type, "paragraph");
  if (paragraph.type === "paragraph") {
    assertEquals(richTextToPlainText(paragraph.text), "Hello 👋");
  }
  assertEquals(
    richMessageToPlainText(richMessage),
    "Title\n\nHello 👋\n\n[x] Checked",
  );

  const manyParagraphs = Array.from({ length: 520 }, (_, i) => `P${i}`).join(
    "\n\n",
  );
  const converted = plainTextToRichMessage(manyParagraphs);
  assertEquals(converted.blocks?.length, 500);

  // Multi-message splitter enforces both 500-block and character limits.
  const multiByBlocks = plainTextToRichMessages(manyParagraphs);
  assertEquals(multiByBlocks.length, 2);
  assertEquals(multiByBlocks[0].blocks?.length, 500);
  assertEquals(multiByBlocks[1].blocks?.length, 20);

  const hugePlain = Array.from({ length: 5 }, (_, i) => `S${i} ` + "x".repeat(9000))
    .join("\n\n");
  const multiByChars = plainTextToRichMessages(hugePlain, 20_000, 500);
  assertEquals(multiByChars.length, 3);
  for (const part of multiByChars) {
    const totalLen = (part.blocks ?? []).reduce(
      (sum, b) => sum + (b.type === "paragraph" ? richTextToPlainText(b.text).length : 0),
      0,
    );
    assertEquals(totalLen <= 20_000, true);
  }
});

Deno.test("richMessageToHtml round-trips leading newline in pre and indented lines losslessly", () => {
  const rm: RichMessage = {
    blocks: [
      { type: "pre", text: "\nconst x = 1;" },
      { type: "paragraph", text: "Line 1\n  — indented\nLine 3" },
    ],
  };
  const { html, context } = richMessageToHtml(rm, { mode: "telegram" });
  const restored = htmlToInputRichMessage(html, context);
  assertEquals(restored, toInputRichMessage(rm));
});

Deno.test("fixPunctuationInRichMessage handles quotes after opening punctuation and prunes empty nodes in space cleanup", () => {
  const quoted: RichMessage = {
    blocks: [
      {
        type: "paragraph",
        text: ["(", { type: "bold", text: '"hello"' }, ")"],
      },
    ],
  };
  const fixed = fixPunctuationInRichMessage(quoted, smartypantsu);
  assertEquals(fixed.changed, true);
  assertEquals(fixed.richMessage.blocks?.[0], {
    type: "paragraph",
    text: ["(", { type: "bold", text: "“hello”" }, ")"],
  });

  const spaced: RichMessage = {
    blocks: [
      {
        type: "paragraph",
        text: ["Hello ", { type: "bold", text: "  " }, "world"],
      },
    ],
  };
  const cleaned = removeRepeatedSpacesInRichMessage(spaced);
  assertEquals(cleaned.changed, true);
  assertEquals(cleaned.richMessage.blocks?.[0], {
    type: "paragraph",
    text: "Hello world",
  });
});

Deno.test("htmlToInputRichMessage rejects empty numeric attributes and recovers resilient LLM HTML", () => {
  assertEquals(
    htmlToInputRichMessage(
      `<tg-map lat="" long=""></tg-map><ol start=""><li value="">Item</li></ol>`,
    ).blocks,
    [
      {
        type: "list",
        items: [{ value: 1, type: "1", blocks: [{ type: "paragraph", text: "Item" }] }],
      },
    ],
  );

  // <p> inside <td> separates lines with newline; span.tg-spoiler works.
  assertEquals(
    htmlToInputRichMessage(
      `<table><tr><td><p>Line 1</p><p><span class="tg-spoiler">Line 2</span></p></td></tr></table>`,
    ).blocks,
    [
      {
        type: "table",
        cells: [[{
          text: ["Line 1\n", { type: "spoiler", text: "Line 2" }],
          align: "left",
          valign: "top",
        }]],
      },
    ],
  );

  // If translator strips <img> inside <figure>, data-tg-media recovers photo + translated caption.
  const rm: RichMessage = {
    blocks: [
      {
        type: "photo",
        photo: [{ file_id: "p_id", file_unique_id: "u", width: 100, height: 100 }],
        caption: { text: "Photo caption" },
      },
    ],
  };
  const { html, context } = richMessageToHtml(rm, { mode: "translate" });
  const strippedImgHtml = html
    .replace(/<img[^>]*>/, "")
    .replace("Photo caption", "Подпись к фото");
  const recovered = htmlToInputRichMessage(strippedImgHtml, context, {
    normalizeTranslatedWhitespace: true,
  });
  assertEquals(recovered.blocks, [
    {
      type: "photo",
      photo: { type: "photo", media: "p_id" },
      caption: { text: "Подпись к фото" },
    },
  ]);

  // Stray prose injected inside <tg-collage> is ignored.
  const collage = htmlToInputRichMessage(
    `<tg-collage><p>stray text</p><img src="https://example.com/a.jpg"></tg-collage>`,
  );
  assertEquals(collage.blocks, [
    {
      type: "collage",
      blocks: [{ type: "photo", photo: { type: "photo", media: "https://example.com/a.jpg" } }],
    },
  ]);
});

Deno.test("translateRichMessageHtml splits oversized single blocks (paragraph, table, escaped text) under maxDocChars", async () => {
  const rm: RichMessage = {
    blocks: [
      {
        type: "paragraph",
        text: "word ".repeat(80).trim(),
      },
      {
        type: "table",
        caption: "Stats",
        cells: Array.from({ length: 10 }, (_, i) => [
          { text: `Row ${i} label`, align: "left" as const, valign: "top" as const },
          { text: `Value ${i}`, align: "right" as const, valign: "top" as const },
        ]),
      },
      {
        type: "paragraph",
        text: "&".repeat(60), // Escapes to 300 chars (> maxDocChars=200)
      },
    ],
  };

  const maxDocChars = 200;
  const seenLengths: number[] = [];
  const translated = await translateRichMessageHtml(
    rm,
    (docs) => {
      for (const doc of docs) seenLengths.push(doc.length);
      return Promise.resolve(docs.map((d) => d.replace(/Row /g, "Строка ")));
    },
    maxDocChars,
  );

  assertEquals(seenLengths.length > 3, true);
  for (const len of seenLengths) {
    assertEquals(len <= maxDocChars, true);
  }
  assertEquals(translated.blocks?.length, 3);
  assertEquals(translated.blocks?.[0], {
    type: "paragraph",
    text: "word ".repeat(80).trim(),
  });
  const tbl = translated.blocks?.[1];
  assertEquals(tbl?.type, "table");
  if (tbl?.type === "table") {
    assertEquals(tbl.cells.length, 10);
    assertEquals(tbl.cells[0][0].text, "Строка 0 label");
    assertEquals(tbl.cells[9][0].text, "Строка 9 label");
  }
  assertEquals(translated.blocks?.[2], {
    type: "paragraph",
    text: "&".repeat(60),
  });
});

Deno.test("splitTextPreservingSeparators preserves exact separators and UTF-16 surrogate pairs", () => {
  const sample = "Alpha beta gamma delta\nSingle line\n\nParagraph two";
  const chunks = splitTextPreservingSeparators(sample, 16);
  const reassembled = chunks.map((c) => c.text + c.separatorAfter).join("");
  assertEquals(reassembled, sample);

  const emojis = "👍".repeat(10); // 20 UTF-16 code units
  const emojiChunks = splitTextPreservingSeparators(emojis, 5);
  for (const c of emojiChunks) {
    assertEquals(c.text.length % 2, 0);
  }
  assertEquals(emojiChunks.map((c) => c.text + c.separatorAfter).join(""), emojis);
});

Deno.test("translateRichMessageHtml keeps oversized bare url/email/phone untranslated and batches string pieces", async () => {
  const longUrl = "https://example.com/" + "a".repeat(220);
  const longEmail = "user." + "b".repeat(180) + "@example.com";
  const longPhone = "+" + "1".repeat(200);
  const rm: RichMessage = {
    blocks: [
      {
        type: "paragraph",
        text: [
          "Visit ",
          { type: "url", url: longUrl, text: longUrl },
          " or ",
          { type: "email_address", email_address: longEmail, text: longEmail },
          " or ",
          { type: "phone_number", phone_number: longPhone, text: longPhone },
        ],
      },
      {
        type: "paragraph",
        text: "word ".repeat(80).trim(),
      },
    ],
  };

  let calls = 0;
  const seenDocs: string[] = [];
  const translated = await translateRichMessageHtml(
    rm,
    (docs) => {
      calls++;
      seenDocs.push(...docs);
      return Promise.resolve(
        docs.map((d) =>
          d.replace("Visit ", "Посетите ").replace(/a/g, "X").replace(/b/g, "Y")
        ),
      );
    },
    150,
  );

  // None of the bare URL / email / phone strings were sent to the translator.
  for (const doc of seenDocs) {
    assertEquals(doc.includes("example.com"), false);
    assertEquals(doc.includes("1111111111"), false);
  }
  assertEquals(translated.blocks?.[0], {
    type: "paragraph",
    text: [
      "Посетите ",
      { type: "url", url: longUrl, text: longUrl },
      " or ",
      { type: "email_address", email_address: longEmail, text: longEmail },
      " or ",
      { type: "phone_number", phone_number: longPhone, text: longPhone },
    ],
  });

  // Oversized paragraph pieces were batched instead of one API call per piece.
  assertEquals(calls <= 4, true);

  // Surrogate pair with tiny maxDocChars terminates without infinite recursion.
  const tiny = await translateRichMessageHtml(
    { blocks: [{ type: "paragraph", text: "👍" }] },
    (docs) => Promise.resolve(docs),
    5,
  );
  assertEquals(tiny.blocks, [{ type: "paragraph", text: "👍" }]);
});

Deno.test("translateRichMessageHtml falls back to original list items and table rows on broken wrapper tags", async () => {
  const rm: RichMessage = {
    blocks: [
      {
        type: "list",
        items: Array.from({ length: 6 }, (_, i) => ({
          label: `${i + 1}.`,
          value: i + 1,
          type: "1" as const,
          blocks: [{ type: "paragraph" as const, text: `Item ${i} ${"x".repeat(30)}` }],
        })),
      },
      {
        type: "table",
        cells: Array.from({ length: 6 }, (_, i) => [
          { text: `Cell ${i} ${"y".repeat(30)}`, align: "left" as const, valign: "top" as const },
        ]),
      },
    ],
  };

  // Translator strips <ul>/<ol>/<table> wrappers completely.
  const translated = await translateRichMessageHtml(
    rm,
    (docs) => Promise.resolve(docs.map(() => "<p>broken</p>")),
    120,
  );

  const list = translated.blocks?.[0];
  assertEquals(list?.type, "list");
  if (list?.type === "list") {
    assertEquals(list.items.length, 6);
    assertEquals(list.items[0].blocks[0], {
      type: "paragraph",
      text: `Item 0 ${"x".repeat(30)}`,
    });
  }

  const table = translated.blocks?.[1];
  assertEquals(table?.type, "table");
  if (table?.type === "table") {
    assertEquals(table.cells.length, 6);
    assertEquals(table.cells[0][0].text, `Cell 0 ${"y".repeat(30)}`);
  }
});

Deno.test("richMessageToHtml preserves captionless map and photo even when translator mangles coordinates or strips img", () => {
  const rm: RichMessage = {
    blocks: [
      {
        type: "map",
        location: { latitude: 41.9, longitude: 12.5, horizontal_accuracy: 15 },
        zoom: 14,
        width: 600,
        height: 400,
      },
      {
        type: "map",
        location: { latitude: 51.5, longitude: -0.1, horizontal_accuracy: 25 },
        zoom: 12,
        width: 500,
        height: 300,
        caption: { text: "London" },
      },
      {
        type: "photo",
        photo: [{ file_id: "solo_img", file_unique_id: "su1", width: 200, height: 200 }],
      },
      {
        type: "collage",
        blocks: [
          {
            type: "photo",
            photo: [{ file_id: "col_img", file_unique_id: "cu1", width: 200, height: 200 }],
          },
        ],
        caption: { text: "Gallery" },
      },
    ],
  };

  const { html, context } = richMessageToHtml(rm, { mode: "translate" });
  const mangled = html
    .replace("41.9", "41,9")
    .replace("51.5", "51,5")
    .replace(/<img[^>]*>/g, "")
    .replace("London", "Лондон")
    .replace("Gallery", "Галерея");

  const restored = htmlToInputRichMessage(mangled, context, {
    normalizeTranslatedWhitespace: true,
  });

  assertEquals(restored.blocks, [
    {
      type: "map",
      location: { latitude: 41.9, longitude: 12.5, horizontal_accuracy: 15 },
      zoom: 14,
      width: 600,
      height: 400,
    },
    {
      type: "map",
      location: { latitude: 51.5, longitude: -0.1, horizontal_accuracy: 25 },
      zoom: 12,
      width: 500,
      height: 300,
      caption: { text: "Лондон" },
    },
    {
      type: "photo",
      photo: { type: "photo", media: "solo_img" },
    },
    {
      type: "collage",
      blocks: [{ type: "photo", photo: { type: "photo", media: "col_img" } }],
      caption: { text: "Галерея" },
    },
  ]);
});

Deno.test("htmlToInputRichMessage prunes empty blocks and matches pre language class strictly", () => {
  const emptyHtml =
    `<p></p><h1></h1><blockquote></blockquote><ul><li></li></ul><table></table>` +
    `<details></details><aside></aside><footer></footer><tg-thinking></tg-thinking>` +
    `<pre><code class="my-language-ts">plain</code></pre>` +
    `<pre><code class="highlight language-rust">fn main() {}</code></pre>`;

  assertEquals(htmlToInputRichMessage(emptyHtml).blocks, [
    { type: "pre", text: "plain" },
    { type: "pre", language: "rust", text: "fn main() {}" },
  ]);
});

Deno.test("plainTextToRichMessages splits CRLF paragraphs and bounds whitespace-only inputs", () => {
  const crlf = plainTextToRichMessages("Para 1\r\n\r\nPara 2\r\n\r\n\r\nPara 3");
  assertEquals(crlf, [{
    blocks: [
      { type: "paragraph", text: "Para 1" },
      { type: "paragraph", text: "Para 2" },
      { type: "paragraph", text: "Para 3" },
    ],
  }]);

  assertEquals(plainTextToRichMessage("Para 1\r\n\r\nPara 2"), {
    blocks: [
      { type: "paragraph", text: "Para 1" },
      { type: "paragraph", text: "Para 2" },
    ],
  });

  const whitespaceOnly = plainTextToRichMessages(" ".repeat(100), 10);
  assertEquals(whitespaceOnly, [{
    blocks: [{ type: "paragraph", text: " " }],
  }]);
  assertEquals(plainTextToRichMessage("   "), {
    blocks: [{ type: "paragraph", text: " " }],
  });
});

Deno.test("inline button prose is isolated from surrounding paragraph context in punctuation and space cleanup", () => {
  const quotedBtn: RichMessage = {
    blocks: [
      {
        type: "paragraph",
        text: [
          "Click:",
          { type: "button", button: { text: '"Go"', url: "https://t.me" } },
          ' and "',
          { type: "button", button: { text: "Open", url: "https://t.me" } },
          '" now',
        ],
      },
    ],
  };
  const fixed = fixPunctuationInRichMessage(quotedBtn, smartypantsu);
  assertEquals(fixed.changed, true);
  assertEquals(fixed.richMessage.blocks?.[0], {
    type: "paragraph",
    text: [
      "Click:",
      { type: "button", button: { text: "“Go”", url: "https://t.me" } },
      " and “",
      { type: "button", button: { text: "Open", url: "https://t.me" } },
      "” now",
    ],
  });

  const spacedBtn: RichMessage = {
    blocks: [
      {
        type: "paragraph",
        text: [
          "Click ",
          { type: "button", button: { text: " Go  now ", url: "https://t.me" } },
          "  next",
        ],
      },
    ],
  };
  const cleaned = removeRepeatedSpacesInRichMessage(spacedBtn);
  assertEquals(cleaned.changed, true);
  assertEquals(cleaned.richMessage.blocks?.[0], {
    type: "paragraph",
    text: [
      "Click ",
      { type: "button", button: { text: " Go now ", url: "https://t.me" } },
      " next",
    ],
  });
});

Deno.test("richMessageToHtml preserves mixed ordered/unordered list items and prunes empty checkbox items", () => {
  const mixedList: RichMessage = {
    blocks: [{
      type: "list",
      items: [
        {
          label: "1.",
          value: 1,
          type: "1",
          blocks: [{ type: "paragraph", text: "First" }],
        },
        {
          label: "•",
          has_checkbox: true,
          is_checked: true,
          blocks: [{ type: "paragraph", text: "Task" }],
        },
      ],
    }],
  };

  for (const mode of ["telegram", "translate"] as const) {
    const { html, context } = richMessageToHtml(mixedList, { mode });
    assertEquals(
      htmlToInputRichMessage(html, context),
      toInputRichMessage(mixedList),
    );
  }

  // Empty checkbox <li> must be pruned rather than emitting blocks: [].
  assertEquals(
    htmlToInputRichMessage(
      `<ul><li><input type="checkbox" checked></li><li><input type="checkbox">Valid</li></ul>`,
    ).blocks,
    [{
      type: "list",
      items: [{
        has_checkbox: true,
        blocks: [{ type: "paragraph", text: "Valid" }],
      }],
    }],
  );
});

Deno.test("richMessageToHtml recovers captionless video/animation/audio/voice_note/document even if translator mangles src", () => {
  const rm: RichMessage = {
    blocks: [
      {
        type: "video",
        video: {
          file_id: "vid1",
          file_unique_id: "vu1",
          width: 640,
          height: 360,
          duration: 10,
        },
        has_spoiler: true,
      },
      {
        type: "animation",
        animation: {
          file_id: "anim1",
          file_unique_id: "au1",
          width: 320,
          height: 240,
          duration: 3,
        },
      },
      {
        type: "audio",
        audio: {
          file_id: "aud1",
          file_unique_id: "mu1",
          duration: 120,
          performer: "Artist",
          title: "Song",
        },
      },
      {
        type: "voice_note",
        voice_note: {
          file_id: "vn1",
          file_unique_id: "vnu1",
          duration: 5,
        },
      },
      {
        type: "document",
        document: {
          file_id: "doc1",
          file_unique_id: "du1",
          file_name: "file.pdf",
        },
      },
    ],
  };

  const { html, context } = richMessageToHtml(rm, { mode: "translate" });
  const mangled = html.replace(/src="[^"]*"/g, 'src="corrupted"');
  assertEquals(
    htmlToInputRichMessage(mangled, context, {
      normalizeTranslatedWhitespace: true,
    }),
    toInputRichMessage(rm),
  );
});

Deno.test("richMessageToHtml recovers captioned media/map when translator mangles src and rejects unresolved tg:// URLs", () => {
  const rm: RichMessage = {
    blocks: [
      {
        type: "photo",
        photo: [{
          file_id: "photo_cap_1",
          file_unique_id: "pu1",
          width: 100,
          height: 100,
        }],
        caption: { text: "Photo caption" },
      },
      {
        type: "video",
        video: {
          file_id: "vid_cap_1",
          file_unique_id: "vu1",
          width: 640,
          height: 360,
          duration: 12,
        },
        caption: { text: "Video caption" },
      },
      {
        type: "map",
        location: { latitude: 41.9, longitude: 12.5 },
        zoom: 14,
        width: 400,
        height: 300,
        caption: { text: "Map caption" },
      },
    ],
  };

  const { html, context } = richMessageToHtml(rm, { mode: "translate" });
  const mangled = html
    .replace("tg://photo?id=m0", "tg://photo?id=m 0")
    .replace("tg://video?id=m1", "tg://video?id=m 1")
    .replace(/data-tg-map-block="[^"]*"/g, (m, offset) =>
      html.slice(Math.max(0, offset - 20), offset).includes("<tg-map") ? "" : m)
    .replace('lat="41.9"', 'lat="999"');

  assertEquals(
    htmlToInputRichMessage(mangled, context, {
      normalizeTranslatedWhitespace: true,
    }),
    toInputRichMessage(rm),
  );

  // Unresolved standalone tg:// media URLs without saved context must be dropped.
  assertEquals(
    htmlToInputRichMessage('<img src="tg://photo?id=missing">').blocks,
    [],
  );
});

Deno.test("translateRichMessageHtml filters stray blocks in oversized collage and avoids empty blocks", async () => {
  const collage: RichMessage = {
    blocks: [{
      type: "collage",
      blocks: [
        {
          type: "photo",
          photo: [{
            file_id: "p1",
            file_unique_id: "u1",
            width: 10,
            height: 10,
          }],
          caption: { text: "Photo one caption" },
        },
        {
          type: "photo",
          photo: [{
            file_id: "p2",
            file_unique_id: "u2",
            width: 10,
            height: 10,
          }],
          caption: { text: "Photo two caption" },
        },
      ],
    }],
  };

  const singlePhotoLen = richMessageToHtml(
    { blocks: [collage.blocks[0].type === "collage" ? collage.blocks[0].blocks[0] : collage.blocks[0]] },
    { mode: "translate" },
  ).html.length;

  const translatedCollage = await translateRichMessageHtml(
    collage,
    (docs) => Promise.resolve(docs.map((d) => `${d}\n<p>Stray note</p>`)),
    singlePhotoLen + 20,
  );
  assertEquals(translatedCollage, toInputRichMessage(collage));

  // Empty translator responses fall back to original blocks rather than blocks: [].
  const listAndQuote: RichMessage = {
    blocks: [
      {
        type: "list",
        items: [
          {
            label: "•",
            blocks: [
              { type: "paragraph", text: "First paragraph in item" },
              { type: "paragraph", text: "Second paragraph in item" },
            ],
          },
          {
            label: "•",
            blocks: [{ type: "paragraph", text: "Short" }],
          },
        ],
      },
      {
        type: "blockquote",
        blocks: [
          { type: "paragraph", text: "Quote line one here" },
          { type: "paragraph", text: "Quote line two here" },
        ],
      },
    ],
  };

  const fallback = await translateRichMessageHtml(
    listAndQuote,
    (docs) => Promise.resolve(docs.map(() => "")),
    65,
  );
  assertEquals(fallback, toInputRichMessage(listAndQuote));
});

Deno.test("richMessageToHtml recovers pre and math blocks via id fallback if data-tg-block is stripped", () => {
  const rm: RichMessage = {
    blocks: [
      { type: "pre", language: "ts", text: "const x = 1;" },
      { type: "mathematical_expression", expression: "E = mc^2" },
    ],
  };

  const { html, context } = richMessageToHtml(rm, { mode: "translate" });
  const stripped = html.replace(/\s*data-tg-block="[^"]*"/g, "");
  assertEquals(
    htmlToInputRichMessage(stripped, context, {
      normalizeTranslatedWhitespace: true,
    }),
    toInputRichMessage(rm),
  );
});

Deno.test("fixPunctuationInRichMessage with createPlainTextSmartypants preserves backslash escapes", () => {
  const rm: RichMessage = {
    blocks: [{
      type: "paragraph",
      text: 'Path C:\\\\dir\\"file\\" and "hello" -- world...',
    }],
  };
  const { richMessage, changed } = fixPunctuationInRichMessage(
    rm,
    createPlainTextSmartypants(smartypantsu),
  );
  assertEquals(changed, true);
  assertEquals(richMessage.blocks?.[0], {
    type: "paragraph",
    text: 'Path C:\\\\dir\\"file\\" and “hello” — world…',
  });
});

Deno.test("translateRichMessageHtml preserves multi-paragraph splits inside chunked rich text, lists, and tables", async () => {
  // Oversized pullquote whose text fits under maxDocChars, while translator splits <br> into </p><p>.
  const pullquote: RichMessage = {
    blocks: [{
      type: "pullquote",
      text: "Line one\nLine two",
      credit: "Author " + "name ".repeat(30).trim(),
    }],
  };
  const translatedPullquote = await translateRichMessageHtml(
    pullquote,
    (docs) =>
      Promise.resolve(
        docs.map((d) =>
          d.replace("Line one<br>Line two", "Строка один</p><p>Строка два")
        ),
      ),
    120,
  );
  assertEquals(translatedPullquote.blocks?.[0]?.type, "pullquote");
  if (translatedPullquote.blocks?.[0]?.type === "pullquote") {
    assertEquals(translatedPullquote.blocks[0].text, "Строка один\nСтрока два");
  }

  // Oversized string paragraph where translator splits a single chunk into two <p> tags.
  const para: RichMessage = {
    blocks: [{
      type: "paragraph",
      text: "Alpha beta gamma delta. " + "word ".repeat(30).trim(),
    }],
  };
  const translatedPara = await translateRichMessageHtml(
    para,
    (docs) =>
      Promise.resolve(
        docs.map((d) =>
          d.replace("Alpha beta gamma delta.", "Alpha</p><p>Delta.")
        ),
      ),
    90,
  );
  assertEquals(translatedPara.blocks?.[0]?.type, "paragraph");
  if (translatedPara.blocks?.[0]?.type === "paragraph") {
    const plain = richTextToPlainText(translatedPara.blocks[0].text);
    assertStringIncludes(plain, "Alpha\nDelta.");
  }

  // Oversized list & table where translator prepends a stray block before <ul>/<table>.
  const listAndTable: RichMessage = {
    blocks: [
      {
        type: "list",
        items: [
          { label: "•", blocks: [{ type: "paragraph", text: "Item one text here" }] },
          { label: "•", blocks: [{ type: "paragraph", text: "Item two text here" }] },
          { label: "•", blocks: [{ type: "paragraph", text: "Item three text here" }] },
        ],
      },
      {
        type: "table",
        cells: [
          [{ text: "Row 1 col A", align: "left", valign: "top" }],
          [{ text: "Row 2 col A", align: "left", valign: "top" }],
          [{ text: "Row 3 col A", align: "left", valign: "top" }],
        ],
      },
    ],
  };
  const translatedLT = await translateRichMessageHtml(
    listAndTable,
    (docs) =>
      Promise.resolve(
        docs.map((d) =>
          `<p>Note</p>${d.replace(/Item/g, "Пункт").replace(/Row/g, "Строка")}`
        ),
      ),
    90,
  );
  assertEquals(translatedLT.blocks?.[0]?.type, "list");
  if (translatedLT.blocks?.[0]?.type === "list") {
    assertEquals(translatedLT.blocks[0].items.length, 3);
    assertEquals(translatedLT.blocks[0].items[0].blocks[0], {
      type: "paragraph",
      text: "Пункт one text here",
    });
  }
  assertEquals(translatedLT.blocks?.[1]?.type, "table");
  if (translatedLT.blocks?.[1]?.type === "table") {
    assertEquals(translatedLT.blocks[1].cells.length, 3);
    assertEquals(translatedLT.blocks[1].cells[0][0].text, "Строка 1 col A");
  }

  // Empty RichText array in an oversized block never throws.
  const emptyArrayRm: RichMessage = {
    blocks: [{ type: "paragraph", text: [] }],
  };
  assertEquals(
    await translateRichMessageHtml(emptyArrayRm, (docs) => Promise.resolve(docs), 2),
    toInputRichMessage(emptyArrayRm),
  );
});

Deno.test("htmlToInputRichMessage prunes empty pre/math and degrades incomplete blockquote/pullquote/details safely", () => {
  assertEquals(
    htmlToInputRichMessage("<pre></pre><tg-math-block></tg-math-block>").blocks,
    [],
  );
  assertEquals(
    htmlToInputRichMessage(
      "<blockquote><cite>Quote Author</cite></blockquote>" +
        "<aside><cite>Pull Author</cite></aside>" +
        "<details><summary>Only Summary</summary></details>" +
        "<details><p>Only Body</p></details>",
    ).blocks,
    [
      { type: "paragraph", text: "Quote Author" },
      { type: "paragraph", text: "Pull Author" },
      { type: "paragraph", text: "Only Summary" },
      { type: "paragraph", text: "Only Body" },
    ],
  );
});

Deno.test("translateRichMessageHtml preserves cross-chunk reference_link even if data-tg-link is stripped", async () => {
  const rm: RichMessage = {
    blocks: [
      {
        type: "paragraph",
        text: [
          "See ",
          { type: "reference_link", reference_name: "n1", text: "note 1" },
          " " + "x".repeat(120),
        ],
      },
      {
        type: "paragraph",
        text: [{ type: "reference", name: "n1", text: "Footnote definition" }],
      },
    ],
  };

  const translated = await translateRichMessageHtml(
    rm,
    (docs) => Promise.resolve(docs.map((d) => d.replace(/\s*data-tg-link="[^"]*"/g, ""))),
    150,
  );
  assertEquals(translated.blocks?.[0], {
    type: "paragraph",
    text: [
      "See ",
      { type: "reference_link", reference_name: "n1", text: "note 1" },
      " " + "x".repeat(120),
    ],
  });
});

Deno.test("richMessageToHtml recovers captionless and captioned media/map/divider/anchor via id fallback if data-* attributes are stripped", async () => {
  const rm: RichMessage = {
    blocks: [
      { type: "paragraph", text: "Intro" },
      { type: "divider" },
      { type: "anchor", name: "sec-1" },
      {
        type: "photo",
        photo: [{ file_id: "p_capless", file_unique_id: "u1", width: 100, height: 100 }],
      },
      {
        type: "photo",
        photo: [{ file_id: "p_captioned", file_unique_id: "u2", width: 100, height: 100 }],
        caption: { text: "Photo caption" },
      },
      {
        type: "map",
        location: { latitude: 41.9, longitude: 12.5 },
        zoom: 14,
        width: 400,
        height: 300,
      },
      {
        type: "map",
        location: { latitude: 48.8, longitude: 2.3 },
        zoom: 12,
        width: 500,
        height: 300,
        caption: { text: "Paris" },
      },
      {
        type: "video",
        video: { file_id: "vid1", file_unique_id: "vu1", width: 320, height: 240, duration: 5 },
      },
      {
        type: "document",
        document: { file_id: "doc1", file_unique_id: "du1" },
      },
    ],
  };

  const translated = await translateRichMessageHtml(
    rm,
    (docs) =>
      Promise.resolve(
        docs.map((d) =>
          d
            .replace(/\s*data-tg-[a-z-]+="[^"]*"/g, "")
            .replace(/<img[^>]*>/g, "")
            .replace(/src="tg:\/\/[^"]*"/g, 'src="tg://broken"')
            .replace(/lat="[^"]*"/g, 'lat="bad"')
        ),
      ),
  );
  assertEquals(translated, toInputRichMessage(rm));
});

Deno.test("plainTextToRichMessage enforces maxChars without splitting surrogate pairs", () => {
  const huge = "abcd👍" + "x".repeat(200);
  const bounded = plainTextToRichMessage(huge, 8);
  assertEquals(bounded.blocks, [{ type: "paragraph", text: "abcd..." }]);

  const multiPara = "First paragraph\n\nSecond paragraph that is way too long";
  const clipped = plainTextToRichMessage(multiPara, 25);
  assertEquals(clipped.blocks?.length, 2);
  const totalLen = (clipped.blocks ?? []).reduce(
    (sum, b, idx) =>
      sum + (idx > 0 ? 1 : 0) +
      (b.type === "paragraph" ? richTextToPlainText(b.text).length : 0),
    0,
  );
  assertEquals(totalLen <= 25, true);
});

Deno.test("htmlToInputRichMessage drops empty buttons without saved context and uses Telegram tg:// schemes", () => {
  assertEquals(
    htmlToInputRichMessage(
      `<tg-button-row><tg-button type="url" url="https://t.me"></tg-button></tg-button-row>` +
        `<p>Hi <tg-button type="url" url="https://t.me"></tg-button></p>`,
    ).blocks,
    [{ type: "paragraph", text: "Hi " }],
  );

  const mediaRm: RichMessage = {
    blocks: [
      {
        type: "animation",
        animation: {
          file_id: "anim_id",
          file_unique_id: "au_id",
          width: 320,
          height: 240,
          duration: 3,
        },
      },
      {
        type: "voice_note",
        voice_note: {
          file_id: "voice_id",
          file_unique_id: "vu_id",
          duration: 5,
        },
      },
    ],
  };

  const { html, context } = richMessageToHtml(mediaRm, { mode: "telegram" });
  assertStringIncludes(html, 'src="tg://video?id=m0"');
  assertStringIncludes(html, 'src="tg://audio?id=m1"');
  assertEquals(htmlToInputRichMessage(html, context), toInputRichMessage(mediaRm));
});

Deno.test("translateRichMessageHtml falls back per chunk when one chunk returns empty HTML", async () => {
  const rm: RichMessage = {
    blocks: [
      { type: "paragraph", text: "Chunk one ".repeat(20).trim() },
      { type: "paragraph", text: "Chunk two ".repeat(20).trim() },
    ],
  };

  const translated = await translateRichMessageHtml(
    rm,
    (docs) =>
      Promise.resolve([
        docs[0].replace(/Chunk one/g, "Часть один"),
        "",
      ]),
    250,
  );

  assertEquals(translated.blocks, [
    { type: "paragraph", text: "Часть один ".repeat(20).trim() },
    { type: "paragraph", text: "Chunk two ".repeat(20).trim() },
  ]);
});

Deno.test("translateRichMessageHtml strips spurious spaces inside and around hyperlinks", async () => {
  const url = "https://t.me/tginfo";
  const rm: RichMessage = {
    blocks: [
      {
        type: "paragraph",
        text: [
          "Check (",
          { type: "url", url, text: "this link" },
          ") and ",
          { type: "url", url, text: "https://t.me/tginfo" },
          ".",
        ],
      },
    ],
  };

  const translated = await translateRichMessageHtml(
    rm,
    (docs) =>
      Promise.resolve(
        docs.map((d) =>
          d
            .replace("Check (", "Проверьте ( ")
            .replace("this link", " эту ссылку ")
            .replace(") and ", " ) и  ")
            .replace("</a>.", "</a> .")
        ),
      ),
  );

  assertEquals(translated.blocks, [
    {
      type: "paragraph",
      text: [
        "Проверьте (",
        { type: "url", url, text: "эту ссылку" },
        ") и ",
        { type: "url", url, text: "https://t.me/tginfo" },
        ".",
      ],
    },
  ]);
});
