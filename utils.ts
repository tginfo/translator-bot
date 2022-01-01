import {
  bgBlue,
  bgGreen,
  bgRed,
  bgWhite,
  bgYellow,
  black,
} from "https://deno.land/std@0.119.0/fmt/colors.ts";
import { Context, GrammyError } from "https://deno.land/x/grammy/mod.ts";
import {
  InlineKeyboardButton,
  InlineKeyboardMarkup,
  MessageEntity,
} from "https://cdn.skypack.dev/@grammyjs/types@v2.5.0?dts";
import { Language, languages } from "./data.ts";

export function answer(ctx: Context, text: string) {
  return ctx.answerCallbackQuery({ text, show_alert: true });
}

export function answerError(ctx: Context, err: unknown) {
  if (err instanceof GrammyError) {
    let text;

    if (err.description.length > 200) {
      text = err.description.slice(0, 197) + "...";
    } else {
      text = err.description;
    }

    return ctx.answerCallbackQuery({ text, show_alert: true });
  }
}

export async function findLanguage(
  ctx: Context & {
    chat: NonNullable<Context["chat"]>;
    from: NonNullable<Context["from"]>;
  }
): Promise<Language & { id: string }> {
  const filteredLanguage = Object.entries(languages).filter(
    ([_, { edit }]) => edit == ctx.chat.id
  )[0];

  if (typeof filteredLanguage === "undefined") {
    await answer(ctx, "Language not found.");
    throw new Error("LanguageNotFound");
  }

  const [id, language] = filteredLanguage;

  if (!language.translators.includes(ctx.from.id)) {
    await answer(ctx, "Action not allowed.");
    throw new Error("ActionNotAllowed");
  }

  return { ...language, id };
}

export function removeButton(
  replyMarkup: InlineKeyboardMarkup,
  callbackData: string
) {
  for (const x in replyMarkup.inline_keyboard) {
    for (const y in replyMarkup.inline_keyboard[x]) {
      if (
        (<InlineKeyboardButton.CallbackButton>replyMarkup.inline_keyboard[x][y])
          .callback_data == callbackData
      ) {
        delete replyMarkup.inline_keyboard[x][y];
      }
    }

    replyMarkup.inline_keyboard[x] = replyMarkup.inline_keyboard[x].filter(
      (y) => y
    );
  }

  replyMarkup.inline_keyboard = replyMarkup.inline_keyboard.filter(
    (x) => x.length != 0
  );
}

export function replaceButton(
  replyMarkup: InlineKeyboardMarkup,
  currentCallbackData: string,
  newText: string | ((current: string) => string),
  newCallbackData: string
) {
  for (const i in replyMarkup.inline_keyboard) {
    const x = replyMarkup.inline_keyboard[i];

    for (const i in x) {
      const y = <InlineKeyboardButton.CallbackButton>x[i];

      if (y.callback_data == currentCallbackData) {
        y.text = typeof newText === "string" ? newText : newText(y.text);
        y.callback_data = newCallbackData;
      }
    }
  }
}

const variants = {
  normal: (str: string) => str,
  primary: (str: string) => bgBlue(black(str)),
  secondary: (str: string) => bgWhite(black(str)),
  success: (str: string) => bgGreen(black(str)),
  warning: (str: string) => bgYellow(black(str)),
  error: (str: string) => bgRed(black(str)),
};

export function log(text: string, variant: keyof typeof variants = "normal") {
  text = new Date().toLocaleTimeString().slice(0, -3) + ": " + text;

  console.log(variants[variant](text));
}

export function hasButton(
  { inline_keyboard }: InlineKeyboardMarkup,
  callbackData: string
) {
  for (const i in inline_keyboard) {
    const x = inline_keyboard[i];

    for (const i in x) {
      const y = <InlineKeyboardButton.CallbackButton>x[i];

      if (y.callback_data.includes(callbackData)) {
        return true;
      }
    }
  }

  return false;
}

export function getUserLink(id: number) {
  return `<a href="tg://user?id=${id}">${id}</>`;
}

export function escape(s: string) {
  s = s.replace(/&/g, "&amp;");
  s = s.replace(/</g, "&lt;");
  s = s.replace(/>/g, "&gt;");
  s = s.replace(/"/g, "&quot;");
  s = s.replace(/\'/g, "&#x27;");
  return s;
}

// Taken from Telethon with some modifications.
export function unparse(
  text: string,
  entities: MessageEntity[],
  offset = 0,
  length?: number
): string {
  if (!text) return text;
  else if (entities.length == 0) return escape(text);

  length = length ?? text.length;

  const html = [];
  let lastOffset = 0;

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];

    if (entity.offset >= offset + length) break;

    const relativeOffset = entity.offset - offset;

    if (relativeOffset > lastOffset)
      html.push(escape(text.slice(lastOffset, relativeOffset)));
    else if (relativeOffset < lastOffset) continue;

    let skipEntity = false;
    const length_ = entity.length;
    const text_ = unparse(
      text.slice(relativeOffset, relativeOffset + length_),
      entities.slice(i + 1, entities.length),
      entity.offset,
      length_
    );

    switch (entity.type) {
      case "bold":
        html.push(`<b>${text_}</b>`);
        break;
      case "italic":
        html.push(`<i>${text_}</i>`);
        break;
      case "underline":
        html.push(`<u>${text_}</u>`);
        break;
      case "strikethrough":
        html.push(`<strike>${text_}</strike>`);
        break;
      case "text_link":
        html.push(`<a href="${entity.url}">${text_}</a>`);
        break;
      case "text_mention":
        html.push(`<a href="tg://user?id=${entity.user.id}">${text_}</a>`);
        break;
      case "spoiler":
        html.push(`<span class="tg-spoiler">${text_}</span>`);
        break;
      case "code":
        html.push(`<code>${text_}</code>`);
        break;
      case "pre":
        html.push(
          `<pre${
            entity.language && ` class="${entity.language}"`
          }>${text_}</pre>`
        );
        break;
      default:
        skipEntity = true;
    }

    lastOffset = relativeOffset + (skipEntity ? 0 : length_);
  }

  html.push(escape(text.slice(lastOffset, text.length)));

  return html.join("");
}
