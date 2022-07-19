import { GTR, MessageEntity, type TranslateOptions } from "./deps.ts";
import { fixText, fixTrans, isZh, unparse } from "./utils.ts";

export class TelegramGTR extends GTR {
  async translate(
    text: string,
    opts: TranslateOptions & { entities?: MessageEntity[] },
  ) {
    const isZh_ = isZh(opts.targetLang);
    text = unparse(text, opts.entities ?? []);
    text = fixText(text, isZh_);
    const result = await super.translate(text, opts);
    result.trans = fixTrans(result.trans, isZh_);
    return result;
  }
}
