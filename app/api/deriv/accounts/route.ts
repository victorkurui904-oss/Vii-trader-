import {
  derivAuthHeaders,
  derivErrorMessage,
  getDerivAccessToken,
  readDerivJson,
  clearDerivTokenCookie,
} from "../../../../lib/deriv-auth";

const noStoreHeaders = { "Cache-Control": "no-store" };
const apiOrigin = "https://api.derivws.com";

function unauthorizedResponse(message: string, clearCookie = false) {
  const response = Response.json(
    { error: message },
    { status: 401, headers: noStoreHeaders },
  );
  if (clearCookie) response.headers.set("Set-Cookie", clearDerivTokenCookie());
  return response;
}

export async function GET(request: Request) {
  const token = getDerivAccessToken(request);
  if (!token) return unauthorizedResponse("Not connected to Deriv.");

  let upstream: Response;
  try {
    upstream = await fetch(`${apiOrigin}/trading/v1/options/accounts`, {
      headers: derivAuthHeaders(token),
      cache: "no-store",
    });
  } catch {
    return Response.json(
      { error: "Could not reach Deriv to load accounts." },
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
            : "Deriv returned an invalid account response.",
      },
      { status: 502, headers: noStoreHeaders },
    );
  }

  if (!upstream.ok) {
    const message = derivErrorMessage(payload, "Could not load Deriv accounts.");
    if (upstream.status === 401) return unauthorizedResponse(message, true);
    return Response.json(
      { error: message },
      { status: upstream.status, headers: noStoreHeaders },
    );
  }

  const accountsResponse = payload as {
    data?: Array<{
      account_id?: unknown;
      account_type?: unknown;
      balance?: unknown;
      currency?: unknown;
      status?: unknown;
    }>;
  };
  if (!Array.isArray(accountsResponse.data)) {
    return Response.json(
      { error: "Deriv returned an invalid account list." },
      { status: 502, headers: noStoreHeaders },
    );
  }

  const accounts = [];
  for (const account of accountsResponse.data) {
    if (
      typeof account.account_id !== "string" ||
      (account.account_type !== "demo" && account.account_type !== "real") ||
      typeof account.currency !== "string" ||
      typeof account.balance !== "number" ||
      account.status !== "active"
    ) {
      return Response.json(
        { error: "Deriv returned an incomplete account record." },
        { status: 502, headers: noStoreHeaders },
      );
    }
    accounts.push({
      accountId: account.account_id,
      loginId: account.account_id,
      currency: account.currency,
      balance: account.balance,
      isVirtual: account.account_type === "demo",
    });
  }

  return Response.json({ accounts }, { headers: noStoreHeaders });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "The Deriv account request is invalid." },
      { status: 400, headers: noStoreHeaders },
    );
  }

  const accountId =
    body && typeof body === "object"
      ? (body as { accountId?: unknown }).accountId
      : undefined;
  if (
    typeof accountId !== "string" ||
    accountId.length === 0 ||
    accountId.length > 64
  ) {
    return Response.json(
      { error: "A valid Deriv account ID is required." },
      { status: 400, headers: noStoreHeaders },
    );
  }

  const token = getDerivAccessToken(request);
  if (!token) return unauthorizedResponse("Not connected to Deriv.");

  let upstream: Response;
  try {
    upstream = await fetch(
      `${apiOrigin}/trading/v1/options/accounts/${encodeURIComponent(accountId)}/otp`,
      {
        method: "POST",
        headers: derivAuthHeaders(token),
        cache: "no-store",
      },
    );
  } catch {
    return Response.json(
      { error: "Could not connect to Deriv to open the trading session." },
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
            : "Deriv returned an invalid WebSocket response.",
      },
      { status: 502, headers: noStoreHeaders },
    );
  }

  if (!upstream.ok) {
    const message = derivErrorMessage(
      payload,
      "Could not open the Deriv trading session.",
    );
    if (upstream.status === 401) return unauthorizedResponse(message, true);
    return Response.json(
      { error: message },
      { status: upstream.status, headers: noStoreHeaders },
    );
  }

  const wsResponse = payload as { data?: { url?: unknown } };
  if (typeof wsResponse.data?.url !== "string") {
    return Response.json(
      { error: "Deriv did not return a WebSocket URL." },
      { status: 502, headers: noStoreHeaders },
    );
  }

  let wsUrl: URL;
  try {
    wsUrl = new URL(wsResponse.data.url);
  } catch {
    return Response.json(
      { error: "Deriv returned an invalid WebSocket URL." },
      { status: 502, headers: noStoreHeaders },
    );
  }
  if (
    wsUrl.protocol !== "wss:" ||
    wsUrl.hostname !== "api.derivws.com" ||
    !/^\/trading\/v1\/options\/ws\/(demo|real)$/.test(wsUrl.pathname)
  ) {
    return Response.json(
      { error: "Deriv returned an unsupported WebSocket URL." },
      { status: 502, headers: noStoreHeaders },
    );
  }

  return Response.json({ url: wsUrl.toString() }, { headers: noStoreHeaders });
}
