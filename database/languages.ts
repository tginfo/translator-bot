import { getDatabase } from "./database.ts";

interface Language {
  id: string;
  targetLang?: string;
  translators: number[];
  main: number;
  beta: number;
  edit: number;
  from: "ru" | "en";
}

const getCollection = () => getDatabase().collection<Language>("langauges");

export const drop = getCollection().drop();

export function update(language: Language) {
  return getCollection().updateOne(
    { id: language.id },
    { $set: { ...language } },
    { upsert: true },
  );
}

export function get(code: string) {
  return getCollection().findOne({ code });
}

export async function del(code: string) {
  return (await getCollection().deleteOne({ code })) != 0;
}

export async function addTranslator(code: string, translator: number) {
  const language = await get(code);

  if (!language) {
    return false;
  }

  await update({
    ...language,
    translators: [...language.translators, translator],
  });
  return true;
}

export async function removeTranslator(code: string, translator: number) {
  const language = await get(code);

  if (!language || !language.translators.includes(translator)) {
    return false;
  }

  delete language.translators[language.translators.indexOf(translator)];

  await update({
    ...language,
  });
  return true;
}

export function getAll() {
  return getCollection().find().toArray();
}
