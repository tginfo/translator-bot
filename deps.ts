import {
  Bot,
  Composer,
  Context as BaseContext,
  GrammyError,
  InlineKeyboard,
  InputFile,
} from "https://deno.land/x/grammy@v1.9.1/mod.ts";
import {
  FileFlavor,
  hydrateFiles,
} from "https://deno.land/x/grammy_files@v1.0.4/mod.ts";

export * as log from "https://deno.land/std@0.148.0/log/mod.ts";
export { setColorEnabled } from "https://deno.land/std@0.148.0/fmt/colors.ts";

export {
  type InlineKeyboardButton,
  type InlineKeyboardMarkup,
  type MessageEntity,
} from "https://deno.land/x/grammy@v1.9.1/platform.deno.ts";

export { config } from "https://deno.land/x/dotenv@v3.2.0/mod.ts";
export { cleanEnv, str } from "https://deno.land/x/envalid@v0.0.3/mod.ts";

export {
  GTR,
  type TranslateOptions,
} from "https://deno.land/x/gtr@v0.0.1/mod.ts";

export { Bot, Composer, GrammyError, hydrateFiles, InlineKeyboard, InputFile };

export type Context = FileFlavor<BaseContext>;
