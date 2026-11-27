import { Context as Context_, GrammyError } from "grammy/mod.ts";
import { FileFlavor } from "grammy_files";
import {
  Language,
  languages,
  supervisors,
  UserSettings,
  userSettings,
} from "./data.ts";
import { truncateText } from "./html_common.ts";

export {
  getUserLink,
  hasButton,
  linkMessage,
  removeButton,
  replaceButton,
} from "./utils_helpers.ts";

export type Context = FileFlavor<Context_>;

export function answer(ctx: Context, text: string) {
  return ctx.answerCallbackQuery({ text, show_alert: true });
}

export function answerError(ctx: Context, err: unknown) {
  if (err instanceof GrammyError) {
    const text = truncateText(err.description, 200);
    return ctx.answerCallbackQuery({ text, show_alert: true });
  }
}

export type TranslatorInfo = Language & {
  id: string;
  userSettings: UserSettings;
  userId: number;
};

export async function findLanguage(
  ctx: Context & {
    chat: NonNullable<Context["chat"]>;
    from: NonNullable<Context["from"]>;
  },
  supervisor?: true,
): Promise<TranslatorInfo> {
  const filteredLanguage = Object.entries(languages).filter(
    ([_, { edit }]) => edit == ctx.chat.id,
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

  if (
    language.supervisorsEnabled && supervisor &&
    !supervisors[id]?.includes(ctx.from.id)
  ) {
    await answer(ctx, "This is only for supervisors.");
    throw new Error("ActionNotAllowed");
  }

  const userSettings = unsafeGetUserSettings(ctx.from.id);

  return { ...language, id, userSettings, userId: ctx.from.id };
}

function unsafeGetUserSettings(userId: string | number) {
  const userKey = String(userId);
  const settings = userSettings[userKey];

  if (!settings) return {};
  return settings;
}
