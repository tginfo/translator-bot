import { GTR, TranslateOptions } from "https://deno.land/x/gtr/mod.ts";

import { MessageEntity } from "https://cdn.skypack.dev/@grammyjs/types@v2.5.0?dts";

import { fixTrans, unparse, isZh, fixText } from "./utils.ts";

export class TelegramGTR extends GTR {
  async translate(
    text: string,
    opts: TranslateOptions & { entities?: MessageEntity[] }
  ) {
    const isZh_ = isZh(opts.targetLang);
    text = unparse(text, opts.entities ?? []);
    text = fixText(text, isZh_);
    const result = await super.translate(text, opts);
    result.trans = fixTrans(result.trans, isZh_);
    return result;
  }
}
