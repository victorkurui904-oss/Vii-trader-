import {
  clearDerivTokenCookie,
  derivErrorMessage,
  derivTokenCookie,
  getDerivOAuthConfig,
  readDerivJson,
} from "../../../../lib/deriv-auth";

const noStoreHeaders = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const { clientId, redirectUri } = getDerivOAuthConfig();
    return Response.json({ clientId, redirectUri }, { headers: noStoreHeaders });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not read Deriv OAuth configuration.",
      },
      { status: 500, headers: noStoreHeaders },
    );
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "The OAuth callback request is invalid." },
      { status: 400, headers: noStoreHeaders },
    );
  }

  const { code, codeVerifier } =
    body && typeof body === "object"
      ? (body as { code?: unknown; codeVerifier?: unknown })
      : {};
  if (
    typeof code !== "string" ||
    code.length === 0 ||
    code.length > 4096 ||
    typeof codeVerifier !== "string" ||
    !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)
  ) {
    return Response.json(
      { error: "The OAuth authorization response is incomplete." },
      { status: 400, headers: noStoreHeaders },
    );
  }

  let config: ReturnType<typeof getDerivOAuthConfig>;
  try {
    config = getDerivOAuthConfig();
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Deriv OAuth is not configured.",
      },
      { status: 500, headers: noStoreHeaders },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch("https://auth.deriv.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.clientId,
        code,
        code_verifier: codeVerifier,
        redirect_uri: config.redirectUri,
      }),
      cache: "no-store",
    });
  } catch {
    return Response.json(
      { error: "Could not reach Deriv to complete authorization." },
      { status: 502, headers: noStoreHeaders },
    );
  }

  let payload: unknown;
  try {
    payload = await readDerivJson(upstream);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Deriv returned an invalid token response.",
      },
      { status: 502, headers: noStoreHeaders },
    );
  }

  if (!upstream.ok) {
    return Response.json(
      {
        error: derivErrorMessage(payload, "Deriv authorization failed."),
      },
      { status: upstream.status, headers: noStoreHeaders },
    );
  }

  const tokenResponse = payload as {
    access_token?: unknown;
    expires_in?: unknown;
  };
  if (
    typeof tokenResponse.access_token !== "string" ||
    typeof tokenResponse.expires_in !== "number" ||
    !Number.isFinite(tokenResponse.expires_in) ||
    tokenResponse.expires_in <= 0
  ) {
    return Response.json(
      { error: "Deriv returned an incomplete token response." },
      { status: 502, headers: noStoreHeaders },
    );
  }

  return Response.json(
    { authenticated: true },
    {
      headers: {
        ...noStoreHeaders,
        "Set-Cookie": derivTokenCookie(
          tokenResponse.access_token,
          Math.floor(tokenResponse.expires_in),
        ),
      },
    },
  );
}

export async function DELETE() {
  return Response.json(
    { authenticated: false },
    {
      headers: {
        ...noStoreHeaders,
        "Set-Cookie": clearDerivTokenCookie(),
      },
    },
  );
}
