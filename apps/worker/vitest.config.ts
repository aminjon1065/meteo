import { defineConfig } from "vitest/config";

// Модули env/db разбирают окружение при импорте. Локально его даёт корневой .env, в CI его нет —
// тестам хватает фиктивного адреса базы (подключений они не открывают; dotenv заданное не перекрывает).
export default defineConfig({
  test: {
    env: {
      DATABASE_URL: "postgres://meteo:meteo@localhost:5432/meteo_test",
    },
  },
});
