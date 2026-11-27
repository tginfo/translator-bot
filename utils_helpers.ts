import type {
  InlineKeyboardButton,
  InlineKeyboardMarkup,
} from "grammy/types.ts";
import * as p from "grammy_parse_mode/mod.ts";

export function removeButton(
  replyMarkup: InlineKeyboardMarkup,
  callbackData: string,
) {
  for (const x in replyMarkup.inline_keyboard) {
    for (const y in replyMarkup.inline_keyboard[x]) {
      if (
        (replyMarkup
          .inline_keyboard[x][y] as InlineKeyboardButton.CallbackButton)
          .callback_data == callbackData
      ) {
        delete replyMarkup.inline_keyboard[x][y];
      }
    }

    replyMarkup.inline_keyboard[x] = replyMarkup.inline_keyboard[x].filter(
      (y) => y,
    );
  }

  replyMarkup.inline_keyboard = replyMarkup.inline_keyboard.filter(
    (x) => x.length != 0,
  );
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
      const y = x[i] as InlineKeyboardButton.CallbackButton;

      if (y.callback_data == currentCallbackData) {
        y.text = typeof newText === "string" ? newText : newText(y.text);
        y.callback_data = newCallbackData;
      }
    }
  }
}

export function hasButton(
  { inline_keyboard }: InlineKeyboardMarkup,
  callbackData: string,
) {
  for (const i in inline_keyboard) {
    const x = inline_keyboard[i];

    for (const i in x) {
      const y = x[i] as InlineKeyboardButton.CallbackButton;

      if (y.callback_data?.includes(callbackData)) {
        return true;
      }
    }
  }

  return false;
}

export function getUserLink(id: number) {
  return `<a href="tg://user?id=${id}">${id}</a>`;
}

export function linkMessage(chatId: number, messageId: number) {
  const entity = p.fmt`${p.linkMessage("A", chatId, messageId)}`.entities[0];
  if (!entity || !("url" in entity)) {
    return "https://tginfo.me/";
  }
  try {
    return new URL(entity.url).href;
  } catch {
    return "https://tginfo.me/";
  }
}
