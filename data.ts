type Sudoer = number;

export interface Language {
  from: "en" | "ru";
  targetLang?: string;
  edit: number;
  translators: number[];
  main: number;
  beta: number;
}

let paths = new Array<string>();

for await (const entry of Deno.readDir("./")) {
  if (
    !entry.isFile || !entry.name.startsWith("data") ||
    !entry.name.endsWith(".json") || entry.name == "data.json"
  ) {
    continue;
  }

  paths.push(entry.name);
}

paths = paths.filter((p) => p != "data.json");

paths.sort((a, b) =>
  Number(a.replace(".json", "").split("-")[1]) -
  Number(b.replace(".json", "").split("-")[1])
);

const path = paths.slice(-1)[0] || "data.json";

const data = JSON.parse(await Deno.readTextFile(path));

export const languages: Record<string, Language> = data.languages;

export const sudoers: Sudoer[] = data.sudoers;

export const alt = -1001253459535;

export const tginfo = 1001003307527;

export const betainfo = -1001313913616;

export const tginfoen = -1001263222189;

export const betainfoen = -1001335406586;

// deno-lint-ignore no-explicit-any
export async function updateData(data: any) {
  if (typeof data.languages === "object" && Array.isArray(data.sudoers)) {
    for (const k in data.languages) {
      languages[k] = data.languages[k];
    }

    for (const k in sudoers) {
      delete sudoers[k];
    }

    for (const sudoer of data.sudoers) {
      sudoers.push(sudoer);
    }

    await Deno.writeTextFile(
      `data-${Date.now()}.json`,
      JSON.stringify({ languages, sudoers }),
    );

    return true;
  }

  return false;
}
