import { listNewsCategories } from "@meteo/db";
import { getDb } from "@/lib/db";

/** Справочники для формы новости. */
export async function loadNewsFormOptions() {
  const categories = await listNewsCategories(getDb());
  return { categories: categories.map((c) => ({ id: c.id, name: c.name })) };
}
