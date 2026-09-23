// Auto-generated type-narrowing wrapper. Do not edit manually.
// Re-exports createEndpoint with context.user typed to the app User.

import type { ZiteRequestContext as _ZiteRequestContext, ZiteScheduledContext, ZiteErrorCode, ZiteSchedule, ZiteStreamInterface, ZiteWebhook } from 'zitejs/backend/base';
import type { User } from 'zitejs/auth';

export type { ZiteErrorCode, ZiteSchedule, ZiteScheduledContext, ZiteStreamInterface, ZiteWebhook };
export type InferSchemaType<T> = T extends { _output: infer U } ? U : T;

export class ZiteError extends Error {
  code: ZiteErrorCode;
  /** Short, non-technical message suitable for showing to an end user. */
  userFacingMessage?: string;
  // Both shapes, mirroring the worker's own class: object form preferred,
  // positional form is what pre-monorepo app code was written against.
  constructor(options: { code: ZiteErrorCode; message: string; userFacingMessage?: string });
  constructor(message: string, code?: ZiteErrorCode);
  constructor(
    optionsOrMessage: { code: ZiteErrorCode; message: string; userFacingMessage?: string } | string,
    legacyCode?: ZiteErrorCode,
  ) {
    if (typeof optionsOrMessage === 'string') {
      super(optionsOrMessage);
      this.code = legacyCode ?? 'INTERNAL_ERROR';
    } else {
      super(optionsOrMessage.message);
      this.code = optionsOrMessage.code;
      this.userFacingMessage = optionsOrMessage.userFacingMessage;
    }
    this.name = 'ZiteError';
  }
}

/**
 * The user an endpoint sees. NOT the full `User` from zitejs/auth — that is
 * the browser's better-auth session, and the runtime never sends its
 * `name`, `emailVerified`, `image`, `createdAt` or `updatedAt` to an
 * endpoint. Typing those here let `context.user.createdAt.getFullYear()`
 * compile and throw. `Omit` keeps any index signature merged in by
 * `.zite/user-extensions.d.ts`, so a migrated user-sync app still reads its
 * synced columns off this.
 *
 * The `Pick` intersection is not redundant. On an app that DOES merge in
 * `[key: string]: any`, `keyof User` widens to `string`, `Exclude` then
 * removes nothing, and the `Omit` collapses to a bare index signature —
 * which would silently degrade `user.id` from `string` to `any`. The `Pick`
 * names those members explicitly, so they survive the collapse.
 *
 * Only `id` and `email` are pinned that way, deliberately. On a user-sync
 * app `context.user` IS the synced row (`buildUserContext` returns it
 * whole), and only those two are guaranteed by the runtime: the id is the
 * record id and the email is merged in explicitly. `firstName`/`lastName`
 * come from whatever the app mapped those columns to, so pinning them to
 * `string` would reject a legitimate read on a table that types them
 * differently. Non-widened apps get both from the `Omit` regardless.
 *
 * On such an app `user.createdAt` still compiles, as `any`. That is
 * deliberate: a synced user table may legitimately have its own
 * `createdAt` column, and typing it `never` to close the hole would break
 * exactly the legacy apps `user-extensions.d.ts` exists to keep compiling.
 */
export type ZiteEndpointUser = Omit<
  User,
  'name' | 'emailVerified' | 'image' | 'createdAt' | 'updatedAt'
> &
  Pick<User, 'id' | 'email'>;

export interface ZiteRequestContext extends Omit<_ZiteRequestContext, "user"> {
  user: ZiteEndpointUser;
}

type SchemaLike<TOut, TIn = TOut> = { _output: TOut; _input: TIn; parse: (data: unknown) => TOut };

export interface EndpointConfig<TInput = unknown, TOutput = unknown, TStream extends boolean = false, TSchedule extends ZiteSchedule | undefined = undefined, TWebhook extends ZiteWebhook | undefined = undefined, TRawInput = TInput> {
  description?: string;
  inputSchema?: SchemaLike<TInput, TRawInput>;
  /** Documentation only. Never validated, and not an inference site for TOutput. */
  outputSchema?: SchemaLike<unknown>;
  stream?: TStream;
  authenticated?: boolean;
  /** When set, the endpoint also fires on this cron schedule. It stays request-callable — declaring one widens `context`, so `context.user` must be null-checked. */
  schedule?: TSchedule;
  /** When set, an inbound webhook can also trigger this endpoint. Like `schedule`, it widens `context` — a webhook fire has no session. */
  webhook?: TWebhook;
  execute: (
    params: {
      input: TInput;
      context: TSchedule extends ZiteSchedule ? ZiteRequestContext | ZiteScheduledContext : TWebhook extends ZiteWebhook ? ZiteRequestContext | ZiteScheduledContext : ZiteRequestContext;
    } & (TStream extends true ? { stream: ZiteStreamInterface } : {}),
  ) => Promise<TOutput> | TOutput;
}

export function createEndpoint<TInput = unknown, TOutput = unknown, TStream extends boolean = false, TSchedule extends ZiteSchedule | undefined = undefined, TWebhook extends ZiteWebhook | undefined = undefined, TRawInput = TInput>(
  config: EndpointConfig<TInput, TOutput, TStream, TSchedule, TWebhook, TRawInput>,
): EndpointConfig<TInput, TOutput, TStream, TSchedule, TWebhook, TRawInput> {
  return config;
}

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      "ZITE_APP_URL": string;
    }
  }
}
