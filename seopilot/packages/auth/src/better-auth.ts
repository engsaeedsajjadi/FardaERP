/**
 * Better Auth server instance (spec §7). Email/password with verification,
 * password reset, Google OAuth, optional TOTP 2FA, session listing/revocation,
 * and an admin plugin for the platform admin panel (ban, impersonate).
 *
 * Emails are dispatched through @seopilot/notifications' email transport; when
 * SMTP is not configured the transport reports "not configured" and the auth
 * flow surfaces that state instead of pretending an email went out.
 */
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor, admin, openAPI } from "better-auth/plugins";
import { getDb, schema } from "@seopilot/db";
import { readEnv, authEnvSchema, coreEnvSchema, logger, AppError } from "@seopilot/shared";
import { passwordPolicyIssues } from "@seopilot/security";
import { sendTransactionalEmail } from "@seopilot/notifications/email";

let instance: Auth | null = null;

function buildOptions() {
  const core = readEnv(coreEnvSchema);
  const env = readEnv(authEnvSchema);
  const baseURL = env.BETTER_AUTH_URL ?? core.APP_URL;
  const isProd = core.NODE_ENV === "production";
  const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

  const options = {
    appName: core.APP_NAME,
    baseURL,
    secret: env.BETTER_AUTH_SECRET,
    basePath: "/api/auth",
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
        twoFactor: schema.twoFactors,
      },
    }),
    user: {
      modelName: "users",
      additionalFields: {
        timezone: { type: "string", required: false, defaultValue: "UTC", input: true },
        locale: { type: "string", required: false, defaultValue: "en", input: true },
        termsAcceptedAt: { type: "date", required: false, input: false },
        marketingConsentAt: { type: "date", required: false, input: false },
      },
      deleteUser: { enabled: false }, // GDPR deletion goes through packages/db gdpr.ts (cascade + billing retention)
      changeEmail: {
        enabled: true,
        sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
          await sendTransactionalEmail({ to: newEmail, template: "verify_email_change", data: { name: user.name, url } });
        },
      },
    },
    session: {
      modelName: "sessions",
      expiresIn: 60 * 60 * 24 * 14,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 15,
      cookieCache: { enabled: true, maxAge: 60 * 5 },
      additionalFields: { activeOrganizationId: { type: "string", required: false } },
    },
    account: { modelName: "accounts", accountLinking: { enabled: true, trustedProviders: ["google"] } },
    verification: { modelName: "verifications" },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendTransactionalEmail({ to: user.email, template: "reset_password", data: { name: user.name, url } });
      },
      onPasswordReset: async ({ user }) => {
        logger.info({ userId: user.id }, "auth.password_reset");
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url }) => {
        await sendTransactionalEmail({ to: user.email, template: "verify_email", data: { name: user.name, url } });
      },
    },
    socialProviders: googleEnabled
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID as string,
            clientSecret: env.GOOGLE_CLIENT_SECRET as string,
            prompt: "select_account",
          },
        }
      : {},
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      storage: "database",
      modelName: "rate_limit_counters_auth",
      customRules: {
        "/sign-in/email": { window: 60, max: 8 },
        "/sign-up/email": { window: 60, max: 5 },
        "/forget-password": { window: 300, max: 3 },
        "/reset-password": { window: 300, max: 5 },
        "/two-factor/verify-totp": { window: 60, max: 5 },
      },
    },
    advanced: {
      useSecureCookies: isProd,
      cookiePrefix: "seopilot",
      defaultCookieAttributes: { sameSite: "lax", httpOnly: true, secure: isProd, path: "/" },
      database: { generateId: "uuid" },
      ipAddress: { ipAddressHeaders: ["x-forwarded-for", "cf-connecting-ip", "x-real-ip"] },
    },
    trustedOrigins: [baseURL, ...(process.env.TRUSTED_ORIGINS?.split(",").filter(Boolean) ?? [])],
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            return { data: { ...user, termsAcceptedAt: new Date() } };
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Enforce password policy on signup / reset / change beyond the length check.
        if (ctx.path === "/sign-up/email" || ctx.path === "/reset-password" || ctx.path === "/change-password") {
          const body = ctx.body as { password?: string; newPassword?: string } | undefined;
          const pw = body?.newPassword ?? body?.password;
          if (pw) {
            const issues = passwordPolicyIssues(pw);
            if (issues.length) throw new AppError("VALIDATION_ERROR", `Password must contain ${issues.join(", ")}`);
          }
        }
      }),
    },
    logger: {
      disabled: false,
      level: isProd ? "warn" : "info",
      log: (level, message) => {
        const fn = level === "error" ? logger.error : level === "warn" ? logger.warn : logger.info;
        fn.call(logger, { component: "better-auth" }, message);
      },
    },
    plugins: [
      twoFactor({
        issuer: core.APP_NAME,
        schema: { twoFactor: { modelName: "two_factors" } },
        otpOptions: {
          sendOTP: async ({ user, otp }) => {
            await sendTransactionalEmail({ to: user.email, template: "two_factor_otp", data: { name: user.name, otp } });
          },
        },
      }),
      admin({ defaultRole: "user", adminRoles: ["admin"], impersonationSessionDuration: 60 * 60 }),
      openAPI({ disableDefaultReference: isProd }),
    ],
  } satisfies BetterAuthOptions;
  return options;
}

export type Auth = ReturnType<typeof betterAuth<ReturnType<typeof buildOptions>>>;

export function createAuth(): Auth {
  if (instance) return instance;
  instance = betterAuth(buildOptions());
  return instance;
}
export type Session = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;

export function isGoogleLoginConfigured(): boolean {
  const env = readEnv(authEnvSchema);
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}
