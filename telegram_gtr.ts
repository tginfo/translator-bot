import { GTR, TranslateOptions } from "https://deno.land/x/gtr/mod.ts";
import { MessageEntity } from "https://cdn.skypack.dev/@grammyjs/types@v2.5.0?dts";
import { unparse } from "./utils.ts";

export class TelegramGTR extends GTR {
  async translate(
    text: string,
    opts: TranslateOptions & { entities?: MessageEntity[] },
  ) {
    const result = await super.translate(
      unparse(text, opts.entities ?? []),
      opts,
    );

    result.trans = result.trans
      .replace(/> /g, ">")
      .replace(/# /g, "#")
      .replace(/ < \/ a>/g, "</a>")
      .replace(/< \/ a>/g, "</a>");

    return result;
  }
}
