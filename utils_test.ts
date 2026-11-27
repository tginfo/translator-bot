import { assertEquals, assertNotEquals } from "@std/assert";
import {
  getUserLink,
  hasButton,
  linkMessage,
  removeButton,
  replaceButton,
} from "./utils_helpers.ts";

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

Deno.test("getUserLink", () => {
  assertEquals(getUserLink(12345), '<a href="tg://user?id=12345">12345</a>');
});

Deno.test("linkMessage", () => {
  assertEquals(linkMessage(1, 1), "https://tginfo.me/");
  assertEquals(linkMessage(1000000000000, 1), "https://tginfo.me/");
  assertEquals(
    linkMessage(-1001202070500, 101),
    "https://t.me/c/1202070500/101",
  );
});
