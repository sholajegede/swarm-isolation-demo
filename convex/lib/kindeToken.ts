import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

/**
 * Kinde access token verification.
 *
 * The acting tenant is whatever this module returns, and nothing else. No part
 * of the request body is consulted. A caller can ask for any resource it likes,
 * but it cannot state who it is.
 *
 * Every failure path ends in a throw. There is no branch that returns an
 * identity without a verified signature.
 */

export const TOKEN_DENY = {
  missing: "missing_token",
  malformed: "malformed_token",
  invalid: "invalid_token",
  expired: "token_expired",
  wrongAudience: "wrong_audience",
  wrongIssuer: "wrong_issuer",
  missingOrgCode: "missing_org_code",
  misconfigured: "server_misconfigured",
} as const;

export type TokenDenyReason = (typeof TOKEN_DENY)[keyof typeof TOKEN_DENY];

export class TokenError extends Error {
  constructor(readonly reason: TokenDenyReason) {
    super(reason);
    this.name = "TokenError";
  }
}

export type VerifiedIdentity = {
  /** The Kinde organization code. This is the acting tenant. */
  orgCode: string;
  /** Permissions carried by the token, already split. */
  scopes: string[];
  /** The M2M application that authenticated, from `azp`. */
  clientId: string;
  /** Token id, recorded in the audit trail. */
  tokenId: string;
  /** Seconds since the epoch. */
  expiresAt: number;
};

/**
 * One JWKS fetcher per issuer, created once per isolate. `jose` caches the key
 * set behind this handle and refetches only when it sees an unknown key id, so
 * verification does not hit Kinde on every request.
 */
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwksFor(issuer: string) {
  let jwks = jwksCache.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60_000,
    });
    jwksCache.set(issuer, jwks);
  }
  return jwks;
}

/** Pull the bearer token out of an Authorization header. */
export function bearerFrom(header: string | null | undefined): string {
  if (!header) {
    throw new TokenError(TOKEN_DENY.missing);
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) {
    throw new TokenError(TOKEN_DENY.malformed);
  }
  return match[1].trim();
}

/**
 * Kinde puts granted API scopes in the space-delimited `scope` string. `scp` is
 * also read so that a token shaped the other way is not silently treated as
 * having no permissions.
 */
export function scopesFrom(payload: JWTPayload): string[] {
  const fromScope =
    typeof payload.scope === "string" ? payload.scope.split(/\s+/) : [];
  const fromScp = Array.isArray(payload.scp)
    ? payload.scp.filter((s): s is string => typeof s === "string")
    : [];
  return [...new Set([...fromScope, ...fromScp])].filter(Boolean);
}

function issuerAndAudience() {
  const issuer = process.env.KINDE_ISSUER_URL?.trim().replace(/\/+$/, "");
  const audience = process.env.KINDE_AUDIENCE?.trim();
  // Without both, there is nothing to verify against. Refuse rather than
  // fall back to an unchecked token.
  if (!issuer || !audience) {
    throw new TokenError(TOKEN_DENY.misconfigured);
  }
  return { issuer, audience };
}

/** Map a `jose` failure onto one of our stable reasons. Anything unrecognised is invalid. */
function reasonFor(error: unknown): TokenDenyReason {
  const code = (error as { code?: string } | undefined)?.code;
  switch (code) {
    case "ERR_JWT_EXPIRED":
      return TOKEN_DENY.expired;
    case "ERR_JWT_CLAIM_VALIDATION_FAILED": {
      const claim = (error as { claim?: string }).claim;
      if (claim === "aud") return TOKEN_DENY.wrongAudience;
      if (claim === "iss") return TOKEN_DENY.wrongIssuer;
      return TOKEN_DENY.invalid;
    }
    case "ERR_JWS_INVALID":
    case "ERR_JWT_INVALID":
      return TOKEN_DENY.malformed;
    default:
      return TOKEN_DENY.invalid;
  }
}

/**
 * Verify a bearer token and return the identity it proves.
 *
 * Signature, issuer, audience and expiry are all checked. A token that passes
 * but carries no `org_code` is refused too: without a tenant there is nothing
 * to scope the call to, and guessing one would defeat the whole boundary.
 */
export async function verifyAccessToken(
  authorizationHeader: string | null | undefined,
): Promise<VerifiedIdentity> {
  const token = bearerFrom(authorizationHeader);
  const { issuer, audience } = issuerAndAudience();

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, jwksFor(issuer), {
      issuer,
      audience,
      // Kinde signs with RS256. Pinning it stops a token from arriving with a
      // weaker algorithm chosen by whoever sent it.
      algorithms: ["RS256"],
    }));
  } catch (error) {
    throw new TokenError(reasonFor(error));
  }

  const orgCode = typeof payload.org_code === "string" ? payload.org_code : "";
  if (!orgCode) {
    throw new TokenError(TOKEN_DENY.missingOrgCode);
  }

  return {
    orgCode,
    scopes: scopesFrom(payload),
    clientId: typeof payload.azp === "string" ? payload.azp : "unknown",
    tokenId: typeof payload.jti === "string" ? payload.jti : "unknown",
    expiresAt: typeof payload.exp === "number" ? payload.exp : 0,
  };
}
