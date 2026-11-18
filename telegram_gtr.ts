import { MessageEntity } from "grammy/types.ts";
import { GTR, TranslateOptions } from "gtr/mod.ts";
import { fixText, fixTrans, isZh, TranslatorInfo, unparse } from "./utils.ts";
import { gCloudTranslate } from "./gcloud_translate.ts";

export class TelegramGTR {
  async translate(
    text: string,
    opts: TranslateOptions & { entities?: MessageEntity[], requestUser: TranslatorInfo },
  ) {
    
    const isZh_ = false // isZh(opts.targetLang); - let's turn this hack off for now
    text = unparse(text, opts.entities ?? []);
    text = fixText(text, isZh_);
    
    const res = await gCloudTranslate({
      content: text,
      targetLanguage: opts.targetLang || "en", // gtr used en as fallback
      requestUser: opts.requestUser
    });
    

    const result = {
      trans: res.content,
      orig: res.sourceLanguage,
      lang: res.targetLanguage,
    }

    result.trans = fixTrans(result.trans, isZh_);
    return result;
  }
}
