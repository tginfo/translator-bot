type Sudoer = number;

export interface Language {
  from: "en" | "ru";
  targetLang?: string;
  edit: number;
  group?: number;
  translators: number[];
  main: number;
  beta: number;
}

let paths = new Array<string>();

for await (const entry of Deno.readDir("./")) {
  if (
    !entry.isFile ||
    !entry.name.startsWith("data") ||
    !entry.name.endsWith(".json") ||
    entry.name == "data.json"
  ) {
    continue;
  }

  paths.push(entry.name);
}

paths = paths.filter((p) => p != "data.json");

paths.sort(
  (a, b) =>
    Number(a.replace(".json", "").split("-")[1]) -
    Number(b.replace(".json", "").split("-")[1]),
);

const path = paths.slice(-1)[0] || "data.json";

const data = JSON.parse(await Deno.readTextFile(path));

export const languages: Record<string, Language> = data.languages;

export const sudoers: Sudoer[] = data.sudoers;

export const support = -1001266712138;

export const channels: Record<
  string,
  Record<string, { name: string; flags?: string[] }>
> = {
  ru: {
    "-1001003307527": { name: "@tginfo" },
    "-1001313913616": { name: "@betainfo", flags: ["beta"] },
    "-1001719500532": { name: "rualt", flags: ["alt"] },
  },
  en: {
    "-1001263222189": { name: "@tginfoen" },
    "-1001335406586": { name: "@betainfoen", flags: ["beta"] },
    "-1001253459535": { name: "enalt", flags: ["alt"] },
  },
};

export async function update(
  func: (
    languages: Record<string, Language>,
    sudoers: Sudoer[],
  ) => Promise<void> | void,
) {
  const result = func(languages, sudoers);

  result instanceof Promise && (await result);

  await Deno.writeTextFile(
    `data-${Date.now()}.json`,
    JSON.stringify({ languages, sudoers }),
  );
}

// deno-lint-ignore no-explicit-any
export async function updateWithFileData(data: any) {
  if (typeof data.languages === "object" && Array.isArray(data.sudoers)) {
    await update((languages, sudoers) => {
      for (const k in data.languages) {
        languages[k] = data.languages[k];
      }

      sudoers.splice(0, sudoers.length);

      for (const sudoer of data.sudoers) {
        sudoers.push(sudoer);
      }
    });

    return true;
  }

  return false;
}

export function dump() {
  return new TextEncoder().encode(JSON.stringify({ languages, sudoers }));
}

export const INLINE_INVITE_LINK_NAME = "tgnftrnsltrbtnln";

export const pilotChats = { ru: -1001037196849, en: -1001192070541 } as const;
export const copilotsChat = -1001266712138;
