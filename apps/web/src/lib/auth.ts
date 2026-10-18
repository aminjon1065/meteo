import "server-only";
import { accounts, sessions, twoFactors, users, verifications } from "@meteo/db/schema";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin, twoFactor } from "better-auth/plugins";
import { getDb } from "./db";
import { env } from "./env";

function createAuth() {
  const e = env();
  return betterAuth({
    appName: "Meteoportal",
    baseURL: e.BETTER_AUTH_URL ?? e.NEXT_PUBLIC_APP_URL,
    secret: e.BETTER_AUTH_SECRET,
    trustedOrigins: [e.NEXT_PUBLIC_APP_URL],
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      usePlural: true,
      schema: { users, sessions, accounts, verifications, twoFactors },
    }),
    emailAndPassword: {
      enabled: true,
      // Самостоятельная регистрация закрыта: пользователей создаёт администратор.
      disableSignUp: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      requireEmailVerification: false,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    user: {
      additionalFields: {
        locale: { type: "string", defaultValue: "tg", input: false },
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 30,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/two-factor/verify-totp": { window: 60, max: 5 },
      },
    },
    plugins: [
      admin({ defaultRole: "editor", adminRoles: ["admin"] }),
      twoFactor({ issuer: "Meteoportal" }),
      nextCookies(),
    ],
  });
}

const globalRef = globalThis as unknown as { __meteoAuth?: ReturnType<typeof createAuth> };

export function getAuth() {
  if (!globalRef.__meteoAuth) {
    globalRef.__meteoAuth = createAuth();
  }
  return globalRef.__meteoAuth;
}

export type Auth = ReturnType<typeof createAuth>;
export type Session = Auth["$Infer"]["Session"];
