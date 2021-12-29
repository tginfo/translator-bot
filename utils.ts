import { Context, GrammyError } from "https://deno.land/x/grammy/mod.ts";
import { Language, languages } from "./data.ts";

export function answer(ctx: Context, text: string) {
  return ctx.answerCallbackQuery({ text, show_alert: true });
}

export function answerWithError(ctx: Context, err: unknown) {
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
): Promise<Language> {
  const filteredLanguage =
    Object.entries(languages).filter(([_, { edit }]) => edit == ctx.chat.id)[0];

  if (typeof filteredLanguage === "undefined") {
    await answer(ctx, "Language not found.");
    throw new Error("LanguageNotFound");
  }

  const [_, language] = filteredLanguage;

  if (!language.translators.includes(ctx.from.id)) {
    await answer(ctx, "Action not allowed.");
    throw new Error("ActionNotAllowed");
  }

  return language;
}
