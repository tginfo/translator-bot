import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.119.0/testing/asserts.ts";

import { MessageEntity } from "https://cdn.skypack.dev/@grammyjs/types@v2.5.0?dts";

import {
  escape,
  fixTrans,
  hasButton,
  removeButton,
  replaceButton,
  unparse,
} from "./utils.ts";

Deno.test("removeButton", () => {
  const replyMarkup = {
    inline_keyboard: [[{ text: "x", callback_data: "y" }]],
  };

  removeButton(replyMarkup, "y");

  assertEquals(replyMarkup.inline_keyboard[0], undefined);
});

Deno.test("replaceButton", () => {
  const replyMarkup = {
    inline_keyboard: [[{ text: "x", callback_data: "y" }]],
  };

  replaceButton(replyMarkup, "y", () => "y", "x");

  assertEquals(replyMarkup.inline_keyboard[0][0].text, "y");
  assertEquals(replyMarkup.inline_keyboard[0][0].callback_data, "x");
});

Deno.test("hasButton", () => {
  const replyMarkup = {
    inline_keyboard: [[{ text: "x", callback_data: "y" }]],
  };

  assertEquals(hasButton(replyMarkup, "y"), true);
  assertNotEquals(hasButton(replyMarkup, "x"), true);
});

Deno.test("escape", () => {
  const escaped = escape('<a href="https://tginfo.me">Telegram Info</a>');

  assertEquals(
    escaped,
    "&lt;a href=&quot;https://tginfo.me&quot;&gt;Telegram Info&lt;/a&gt;",
  );
});

Deno.test("unparse", () => {
  const text =
    `Pavel Durov is the luckiest Russian ever according to this a>ticle.

  — sendMessage and editMessageText are the most used Bot API methods.

"Probably soon, but not today." — said Telegram on Twitter.

This text is underlined and a spoiler!`;

  const entities: MessageEntity[] = [
    { type: "bold", offset: 0, length: 11 },
    {
      type: "text_link",
      url: "http://telegra.ph/?fb_cli_id=%15%12",
      offset: 54,
      length: 12,
    },
    { type: "code", offset: 73, length: 11 },
    { type: "code", offset: 89, length: 15 },
    { type: "italic", offset: 141, length: 31 },
    { type: "spoiler", offset: 202, length: 38 },
    { type: "underline", offset: 202, length: 38 },
  ];

  const html = unparse(text, entities);

  assertEquals(
    html,
    `<b>Pavel Durov</b> is the luckiest Russian ever according to <a href="http://telegra.ph/?fb_cli_id=%15%12">this a&gt;ticle</a>.

  — <code>sendMessage</code> and <code>editMessageText</code> are the most used Bot API methods.

<i>&quot;Probably soon, but not today.&quot;</i> — said Telegram on Twitter.

<span class="tg-spoiler"><u>This text is underlined and a spoiler!</u></span>`,
  );
});

Deno.test("fixTrans", () => {
  const trans =
    `< b>Lê em ji wan re gotin:< / b> < i >&quot; Ma hûn nizanîbû ku Telegramê zêdetir rêzê li bikarînerên xwe digire? < a href = "https://telegram.org" >Herin aniha dakişînin!< /a>&quot;</i >`;

  const result = fixTrans(trans);
  const expected =
    `<b>Lê em ji wan re gotin:</b> <i>&quot; Ma hûn nizanîbû ku Telegramê zêdetir rêzê li bikarînerên xwe digire? <a href="https://telegram.org">Herin aniha dakişînin!</a>&quot;</i>`;

  assertEquals(result, expected);
});
