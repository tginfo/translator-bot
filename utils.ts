import { Context, GrammyError } from "https://deno.land/x/grammy/mod.ts";
import {
  InlineKeyboardButton,
  InlineKeyboardMarkup,
} from "https://cdn.skypack.dev/@grammyjs/types@v2.4.5?dts";
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
  },
): Promise<Language & { id: string }> {
  const filteredLanguage =
    Object.entries(languages).filter(([_, { edit }]) => edit == ctx.chat.id)[0];

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
  callbackData: string,
) {
  for (const i in replyMarkup.inline_keyboard) {
    const x = replyMarkup.inline_keyboard[i];

    for (const i in x) {
      if (
        (<InlineKeyboardButton.CallbackButton> x[i]).callback_data ==
          callbackData
      ) {
        delete x[i];
      }
    }
  }
}

export function replaceButton(
  replyMarkup: InlineKeyboardMarkup,
  currentCallbackData: string,
  newText: string | ((current: string) => string),
  newCallbackData: string,
) {
  for (const i in replyMarkup.inline_keyboard) {
    const x = replyMarkup.inline_keyboard[i];

    for (const i in x) {
      const y = <InlineKeyboardButton.CallbackButton> x[i];

      if (y.callback_data == currentCallbackData) {
        y.text = typeof newText === "string" ? newText : newText(y.text);
        y.callback_data = newCallbackData;
      }
    }
  }
}
