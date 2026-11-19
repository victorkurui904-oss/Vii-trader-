export const DERIV_ACCESS_TOKEN_COOKIE = "deriv_access_token";

export function getDerivOAuthConfig() {
  const clientId = process.env.DERIV_CLIENT_ID;
  const redirectUri = process.env.DERIV_REDIRECT_URL;

  if (!clientId || !redirectUri) {
    throw new Error("Deriv OAuth is not configured.");
  }

  let redirect: URL;
  try {
    redirect = new URL(redirectUri);
  } catch {
    throw new Error("The Deriv OAuth redirect URL is invalid.");
  }

  if (
    redirect.protocol !== "https:" &&
    !(redirect.protocol === "http:" && redirect.hostname === "localhost")
  ) {
    throw new Error("The Deriv OAuth redirect URL must use HTTPS.");
  }

  return { clientId, redirectUri };
}

export function getDerivAccessToken(request: Request) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  for (const cookie of cookieHeader.split(";")) {
    const [name, ...valueParts] = cookie.trim().split("=");
    if (name !== DERIV_ACCESS_TOKEN_COOKIE) continue;

    try {
      return decodeURIComponent(valueParts.join("=")) || null;
    } catch {
      return null;
    }
  }

  return null;
}

export async function readDerivJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new Error("Deriv returned an invalid response.");
  }
}

export function derivErrorMessage(value: unknown, fallback: string) {
  if (!value || typeof value !== "object") return fallback;

  const body = value as {
    error?: unknown;
    error_description?: unknown;
    errors?: Array<{ message?: unknown }>;
  };
  const message =
    body.errors?.find((item) => typeof item.message === "string")?.message ??
    body.error_description ??
    body.error;

  return typeof message === "string" && message ? message : fallback;
}

export function derivAuthHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export function derivTokenCookie(token: string, maxAge: number) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${DERIV_ACCESS_TOKEN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearDerivTokenCookie() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${DERIV_ACCESS_TOKEN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
