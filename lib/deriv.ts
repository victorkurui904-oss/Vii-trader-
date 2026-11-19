const DERIV_PUBLIC_WS_URL =
  "wss://api.derivws.com/trading/v1/options/ws/public";

export type DerivResponse = {
  req_id?: number;
  msg_type?: string;
  error?: { message?: string; code?: string };
  authorize?: {
    loginid?: string;
    currency?: string;
    balance?: number;
  };
  balance?: { balance?: number; currency?: string };
  proposal?: { id?: string; ask_price?: number; payout?: number };
  buy?: { contract_id?: number; buy_price?: number; payout?: number };
  active_symbols?: Array<{
    underlying_symbol: string;
    underlying_symbol_name: string;
    market: string;
    pip_size: number;
  }>;
  history?: { prices?: Array<number | string>; pip_size?: number };
  pip_size?: number;
  tick?: {
    symbol?: string;
    quote?: number;
    pip_size?: number;
  };
  subscription?: { id?: string };
  proposal_open_contract?: {
    contract_id?: number;
    is_sold?: number | boolean;
    profit?: number;
  };
};

export type DerivTick = NonNullable<DerivResponse["tick"]>;

export type DerivClient = {
  request: (payload: Record<string, unknown>) => Promise<DerivResponse>;
  subscribeTicks: (
    symbol: string,
    onTick: (tick: DerivTick) => void,
  ) => Promise<() => Promise<void>>;
  waitForContract: (contractId: number) => Promise<number>;
  close: () => void;
};

export async function connectDeriv(accountId?: string): Promise<DerivClient> {
  let url = DERIV_PUBLIC_WS_URL;
  if (accountId) {
    let response: Response;
    try {
      response = await fetch("/api/deriv/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
        cache: "no-store",
      });
    } catch {
      throw new Error("Could not request an authenticated Deriv connection.");
    }

    let payload: { error?: string; url?: unknown };
    try {
      payload = (await response.json()) as { error?: string; url?: unknown };
    } catch {
      throw new Error("The server returned an invalid Deriv connection response.");
    }
    if (!response.ok) {
      throw new Error(
        payload.error || "Could not open an authenticated Deriv connection.",
      );
    }
    if (typeof payload.url !== "string") {
      throw new Error("Deriv did not return a WebSocket connection URL.");
    }
    url = payload.url;
  }

  const socket = new WebSocket(url);
  const pending = new Map<
    number,
    {
      resolve: (response: DerivResponse) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();
  const handlers = new Set<(response: DerivResponse) => void>();
  let nextRequestId = 1;

  const rejectPending = (error: Error) => {
    for (const [requestId, request] of pending) {
      clearTimeout(request.timeout);
      request.reject(error);
      pending.delete(requestId);
    }
  };

  socket.addEventListener("message", (event: MessageEvent<string>) => {
    let response: DerivResponse;
    try {
      response = JSON.parse(event.data) as DerivResponse;
    } catch {
      rejectPending(new Error("Received an invalid response from Deriv."));
      return;
    }

    for (const handler of handlers) handler(response);
    if (response.req_id === undefined) return;
    const request = pending.get(response.req_id);
    if (!request) return;

    clearTimeout(request.timeout);
    pending.delete(response.req_id);
    if (response.error) {
      request.reject(new Error(response.error.message ?? "Deriv request failed."));
    } else {
      request.resolve(response);
    }
  });

  socket.addEventListener("close", () => {
    rejectPending(new Error("The Deriv connection was closed."));
    for (const handler of handlers) {
      handler({ msg_type: "connection_closed" });
    }
  });
  socket.addEventListener("error", () => {
    rejectPending(new Error("Could not connect to Deriv."));
  });

  const request = (payload: Record<string, unknown>) =>
    new Promise<DerivResponse>((resolve, reject) => {
      if (socket.readyState !== WebSocket.OPEN) {
        reject(new Error("The Deriv connection is not open."));
        return;
      }

      const reqId = nextRequestId++;
      const timeout = setTimeout(() => {
        pending.delete(reqId);
        reject(new Error("Deriv did not respond in time."));
      }, 15_000);
      pending.set(reqId, { resolve, reject, timeout });
      socket.send(JSON.stringify({ ...payload, req_id: reqId }));
    });

  const subscribeTicks: DerivClient["subscribeTicks"] = async (symbol, onTick) => {
    const handler = (response: DerivResponse) => {
      if (
        response.msg_type === "tick" &&
        response.tick?.symbol === symbol
      ) {
        onTick(response.tick);
      }
    };
    handlers.add(handler);
    try {
      const response = await request({ ticks: symbol, subscribe: 1 });
      const subscriptionId = response.subscription?.id;
      if (!subscriptionId) {
        throw new Error("Deriv did not return a tick subscription.");
      }
      return async () => {
        handlers.delete(handler);
        await request({ forget: subscriptionId });
      };
    } catch (error) {
      handlers.delete(handler);
      throw error;
    }
  };

  const waitForContract: DerivClient["waitForContract"] = async (contractId) => {
    let subscriptionId: string | undefined;
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let finish!: (error?: Error, profit?: number) => void;
    const result = new Promise<number>((resolve, reject) => {
      finish = (error, profit) => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        if (error) reject(error);
        else if (typeof profit === "number") resolve(profit);
        else reject(new Error("Deriv did not return a contract result."));
      };
    });
    const onContract = (response: DerivResponse) => {
      if (response.msg_type === "connection_closed") {
        finish(new Error("The Deriv connection closed before the trade settled."));
        return;
      }
      const contract = response.proposal_open_contract;
      if (
        response.msg_type === "proposal_open_contract" &&
        contract?.contract_id === contractId &&
        Boolean(contract.is_sold)
      ) {
        finish(undefined, contract.profit);
      }
    };
    const onClose = () =>
      finish(new Error("The Deriv connection closed before the trade settled."));
    handlers.add(onContract);
    socket.addEventListener("close", onClose, { once: true });
    timeout = setTimeout(
      () => finish(new Error("Timed out waiting for the Deriv contract result.")),
      30_000,
    );

    try {
      const response = await request({
        proposal_open_contract: 1,
        contract_id: contractId,
        subscribe: 1,
      });
      subscriptionId = response.subscription?.id;
      const contract = response.proposal_open_contract;
      if (
        contract?.contract_id === contractId &&
        Boolean(contract.is_sold)
      ) {
        finish(undefined, contract.profit);
      }
      return await result;
    } finally {
      if (timeout) clearTimeout(timeout);
      handlers.delete(onContract);
      socket.removeEventListener("close", onClose);
      if (subscriptionId && socket.readyState === WebSocket.OPEN) {
        await request({ forget: subscriptionId });
      }
    }
  };

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Timed out connecting to Deriv."));
    }, 15_000);
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timeout);
        reject(new Error("Could not connect to Deriv."));
      },
      { once: true },
    );
  });

  return {
    request,
    subscribeTicks,
    waitForContract,
    close: () => socket.close(),
  };
}
