/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as audit from "../audit.js";
import type * as http from "../http.js";
import type * as lib_decide from "../lib/decide.js";
import type * as lib_kindeToken from "../lib/kindeToken.js";
import type * as lib_seam from "../lib/seam.js";
import type * as lib_tenancy from "../lib/tenancy.js";
import type * as resources from "../resources.js";
import type * as seed from "../seed.js";
import type * as settings from "../settings.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  audit: typeof audit;
  http: typeof http;
  "lib/decide": typeof lib_decide;
  "lib/kindeToken": typeof lib_kindeToken;
  "lib/seam": typeof lib_seam;
  "lib/tenancy": typeof lib_tenancy;
  resources: typeof resources;
  seed: typeof seed;
  settings: typeof settings;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
