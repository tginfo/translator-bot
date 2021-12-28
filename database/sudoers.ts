import { getDatabase } from "./database.ts";

interface Sudoer {
  id: number;
}

const getCollection = () => getDatabase().collection<Sudoer>("sudoers");

export const drop = getCollection().drop();

export async function add(id: number) {
  return (
    (await getCollection().updateOne({}, { id }, { upsert: true }))
      .matchedCount == 0
  );
}

export async function remove(id: number) {
  return (await getCollection().deleteOne({ id })) != 0;
}

export async function getAll() {
  return (await getCollection().find().toArray()).map((s) => s.id);
}
