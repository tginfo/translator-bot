type Sudoer = number;

interface Language {
  from: "en" | "ru";
  targetLang?: string;
  edit: number;
  translators: number[];
  main: number;
  beta: number;
}

const data = JSON.parse(await Deno.readTextFile("data.json"));

export const languages: Record<string, Language> = data.languages;

export const sudoers: Sudoer[] = data.sudoers;

export const alt = -1001589900563;

export const tginfo = 1001003307527;

export const betainfo = -1001313913616;

export const tginfoen = -1001263222189;

export const betainfoen = -1001335406586;
