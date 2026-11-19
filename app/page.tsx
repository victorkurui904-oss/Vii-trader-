"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  connectDeriv,
  type DerivClient,
  type DerivTick,
} from "../lib/deriv";

type DerivAccount = {
  accountId: string;
  loginId: string;
  currency: string;
  balance: number;
  isVirtual: boolean;
};

type Market = {
  symbol: string;
  display_name: string;
  market: string;
  pip_size?: number;
};

type ScanResult = {
  symbol: string;
  name: string;
  contract: "Even" | "Odd" | "Over" | "Under" | "Matches" | "Differs";
  barrier?: number;
  hits: number;
  sampleSize: number;
  hitRate: number;
};

type ScanCategory = "ALL" | "PARITY" | "OVER_UNDER" | "MATCHES_DIFFERS";
type DigitContract =
  | "DIGITEVEN"
  | "DIGITODD"
  | "DIGITOVER"
  | "DIGITUNDER"
  | "DIGITMATCH"
  | "DIGITDIFF";

type BotConfig = {
  name: string;
  symbol: string;
  contract: DigitContract;
  barrier?: number;
  stake: number;
  maxTrades: number;
  stopLoss?: number;
  takeProfit?: number;
  martingaleEnabled?: boolean;
  multiplier?: number;
  duration?: number;
};

type BotStatus = "idle" | "starting" | "running" | "stopping" | "stopped" | "error";

type Master5Run = {
  client?: DerivClient;
  running: boolean;
  inTrade: boolean;
  target: "EVEN" | "ODD";
  symbol: string;
  currency: string;
  baseStake: number;
  currentStake: number;
  multiplier: number;
  takeProfit: number;
  stopLoss: number;
  tradeLimit: number;
  trades: number;
  profit: number;
  oppositeStreak: number;
  stopMessage: string;
};

type BotView = {
  status: BotStatus;
  trades: number;
  profit: number;
  stake: number;
  message: string;
};

type LiveDigitStats = {
  symbol: string;
  digit: number;
  quote: number;
  counts: number[];
};

type ManualRunConfig = {
  symbol: string;
  contract: DigitContract;
  barrier?: number;
  stake: number;
  stopLoss: number;
  takeProfit: number;
  martingaleEnabled: boolean;
  multiplier: number;
  duration: number;
  maxTrades: number;
};

type ManualRun = ManualRunConfig & {
  client?: DerivClient;
  running: boolean;
  inTrade: boolean;
  currentStake: number;
  trades: number;
  profit: number;
  stopMessage: string;
};

const TICK_DURATIONS = [1, 2, 5, 10];

const FALLBACK_MARKETS: Market[] = [
  { symbol: "R_10", display_name: "Volatility 10 Index", market: "synthetic_index" },
  { symbol: "R_15", display_name: "Volatility 15 Index", market: "synthetic_index" },
  { symbol: "R_25", display_name: "Volatility 25 Index", market: "synthetic_index" },
  { symbol: "R_30", display_name: "Volatility 30 Index", market: "synthetic_index" },
  { symbol: "R_50", display_name: "Volatility 50 Index", market: "synthetic_index" },
  { symbol: "R_75", display_name: "Volatility 75 Index", market: "synthetic_index" },
  { symbol: "R_90", display_name: "Volatility 90 Index", market: "synthetic_index" },
  { symbol: "R_100", display_name: "Volatility 100 Index", market: "synthetic_index" },
  { symbol: "1HZ10V", display_name: "Volatility 10 (1s) Index", market: "synthetic_index" },
  { symbol: "1HZ15V", display_name: "Volatility 15 (1s) Index", market: "synthetic_index" },
  { symbol: "1HZ25V", display_name: "Volatility 25 (1s) Index", market: "synthetic_index" },
  { symbol: "1HZ30V", display_name: "Volatility 30 (1s) Index", market: "synthetic_index" },
  { symbol: "1HZ50V", display_name: "Volatility 50 (1s) Index", market: "synthetic_index" },
  { symbol: "1HZ75V", display_name: "Volatility 75 (1s) Index", market: "synthetic_index" },
  { symbol: "1HZ90V", display_name: "Volatility 90 (1s) Index", market: "synthetic_index" },
  { symbol: "1HZ100V", display_name: "Volatility 100 (1s) Index", market: "synthetic_index" },
];
const FREE_BOTS: BotConfig[] = [
  { name: "Even Starter", symbol: "R_10", contract: "DIGITEVEN", stake: 1, maxTrades: 3 },
  { name: "Over 5 Watch", symbol: "R_25", contract: "DIGITOVER", barrier: 5, stake: 1, maxTrades: 2 },
  { name: "Differs 7", symbol: "R_50", contract: "DIGITDIFF", barrier: 7, stake: 0.5, maxTrades: 2 },
  { name: "Master 5", symbol: "R_10", contract: "DIGITEVEN", stake: 1, maxTrades: 20 },
];

const DIGIT_CONTRACT_OPTIONS: Array<{ value: DigitContract; label: string }> = [
  { value: "DIGITEVEN", label: "Even" },
  { value: "DIGITODD", label: "Odd" },
  { value: "DIGITOVER", label: "Over" },
  { value: "DIGITUNDER", label: "Under" },
  { value: "DIGITMATCH", label: "Matches" },
  { value: "DIGITDIFF", label: "Differs" },
];

function base64UrlEncode(bytes: Uint8Array) {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function isDerivAccount(value: unknown): value is DerivAccount {
  if (!value || typeof value !== "object") return false;
  const account = value as Record<string, unknown>;
  return (
    typeof account.accountId === "string" &&
    typeof account.loginId === "string" &&
    typeof account.currency === "string" &&
    typeof account.balance === "number" &&
    typeof account.isVirtual === "boolean"
  );
}

function contractNeedsBarrier(contract: DigitContract) {
  return contract !== "DIGITEVEN" && contract !== "DIGITODD";
}

function contractLabel(contract: DigitContract, barrier: number | string) {
  const label = DIGIT_CONTRACT_OPTIONS.find((option) => option.value === contract)?.label ?? contract;
  return contractNeedsBarrier(contract) ? `${label} ${barrier}` : label;
}

function validDigitBarrier(contract: DigitContract, value: number) {
  if (!Number.isInteger(value)) return false;
  if (contract === "DIGITOVER") return value >= 0 && value <= 8;
  if (contract === "DIGITUNDER") return value >= 1 && value <= 9;
  return value >= 0 && value <= 9;
}

function getLastDigit(price: number | string, pipSize?: number) {
  const text =
    typeof price === "string"
      ? price
      : typeof pipSize === "number" &&
          Number.isInteger(pipSize) &&
          pipSize >= 0 &&
          pipSize <= 10
        ? price.toFixed(pipSize)
        : price.toString();
  const digits = text.replace(/\D/g, "");
  const last = digits.at(-1);
  return last === undefined ? null : Number(last);
}

function scanDigitContracts(
  market: Market,
  prices: Array<number | string>,
  pipSize?: number,
): ScanResult[] {
  const counts = Array.from({ length: 10 }, () => 0);
  for (const price of prices) {
    const digit = getLastDigit(price, pipSize);
    if (digit !== null && digit >= 0 && digit <= 9) counts[digit] += 1;
  }
  const sampleSize = counts.reduce((total, count) => total + count, 0);
  if (sampleSize === 0) return [];

  const result = (
    contract: ScanResult["contract"],
    hits: number,
    barrier?: number,
  ): ScanResult => ({
    symbol: market.symbol,
    name: market.display_name,
    contract,
    barrier,
    hits,
    sampleSize,
    hitRate: (hits / sampleSize) * 100,
  });
  const results = [
    result("Even", counts.reduce((total, count, digit) => total + (digit % 2 === 0 ? count : 0), 0)),
    result("Odd", counts.reduce((total, count, digit) => total + (digit % 2 === 1 ? count : 0), 0)),
  ];

  for (let barrier = 0; barrier <= 8; barrier += 1) {
    results.push(
      result(
        "Over",
        counts.reduce((total, count, digit) => total + (digit > barrier ? count : 0), 0),
        barrier,
      ),
    );
  }
  for (let barrier = 1; barrier <= 9; barrier += 1) {
    results.push(
      result(
        "Under",
        counts.reduce((total, count, digit) => total + (digit < barrier ? count : 0), 0),
        barrier,
      ),
    );
  }
  for (let barrier = 0; barrier <= 9; barrier += 1) {
    results.push(result("Matches", counts[barrier], barrier));
    results.push(result("Differs", sampleSize - counts[barrier], barrier));
  }
  return results;
}

function contractFromScanResult(result: ScanResult): DigitContract {
  switch (result.contract) {
    case "Even": return "DIGITEVEN";
    case "Odd": return "DIGITODD";
    case "Over": return "DIGITOVER";
    case "Under": return "DIGITUNDER";
    case "Matches": return "DIGITMATCH";
    case "Differs": return "DIGITDIFF";
  }
}

function DigitVisualizer({
  symbol,
  stats,
}: {
  symbol: string;
  stats: LiveDigitStats | null;
}) {
  const counts = stats?.symbol === symbol ? stats.counts : Array.from({ length: 10 }, () => 0);
  const sampleSize = counts.reduce((total, count) => total + count, 0);
  const maxCount = Math.max(...counts);
  const minCount = Math.min(...counts);
  const activeDigit = stats?.symbol === symbol ? stats.digit : -1;

  return (
    <div className="digit-visualizer" aria-label={`${symbol} live last-digit frequency`}>
      <div className="digit-visualizer-heading">
        <div><strong>Live last-digit frequency</strong><small>{symbol} · {sampleSize} recent ticks</small></div>
        <span className="live-indicator"><i /> {stats?.symbol === symbol ? "LIVE" : "WAITING"}</span>
      </div>
      {[0, 1].map((row) => {
        const rowDigits = Array.from({ length: 5 }, (_, index) => row * 5 + index);
        const rowStyle = {
          "--digit-position": String(activeDigit >= 0 && Math.floor(activeDigit / 5) === row ? activeDigit % 5 : 0),
        } as CSSProperties & { "--digit-position": string };
        return (
          <div className={`digit-row ${activeDigit >= 0 && Math.floor(activeDigit / 5) === row ? "has-active" : ""}`} key={row}>
            {rowDigits.map((digit) => {
              const percentage = sampleSize > 0 ? (counts[digit] / sampleSize) * 100 : 0;
              return (
                <div
                  className={`digit-cell${digit === activeDigit ? " digit-active" : ""}${sampleSize > 0 && counts[digit] === maxCount ? " digit-highest" : ""}${sampleSize > 0 && minCount < maxCount && counts[digit] === minCount ? " digit-lowest" : ""}`}
                  key={digit}
                  aria-label={`Digit ${digit}: ${percentage.toFixed(1)}%`}
                >
                  <span className="digit-circle">{digit}</span>
                  <span className="digit-frequency">{percentage.toFixed(1)}%</span>
                </div>
              );
            })}
            <span className="digit-pointer" style={rowStyle} aria-hidden="true">▼</span>
          </div>
        );
      })}
      <div className="digit-visualizer-footer">
        <span>{stats?.symbol === symbol ? `Latest digit: ${stats.digit} · ${stats.quote}` : "Waiting for the next Deriv tick…"}</span>
        <span><i className="legend-high" /> Highest <i className="legend-low" /> Lowest</span>
      </div>
    </div>
  );
}

export default function HomePage() {
  const [showIntro, setShowIntro] = useState(true);
  const [accounts, setAccounts] = useState<DerivAccount[]>([]);
  const [selectedLoginId, setSelectedLoginId] = useState("");
  const [accountError, setAccountError] = useState("");
  const [connection, setConnection] = useState("Connecting");
  const [balance, setBalance] = useState<number | null>(null);
  const [currency, setCurrency] = useState("");
  const [markets, setMarkets] = useState(FALLBACK_MARKETS);
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketError, setMarketError] = useState("");
  const [symbol, setSymbol] = useState("R_10");
  const [contract, setContract] = useState<DigitContract>("DIGITEVEN");
  const [barrier, setBarrier] = useState("5");
  const [stake, setStake] = useState("1");
  const [duration, setDuration] = useState(1);
  const [manualStopLoss, setManualStopLoss] = useState("5");
  const [manualTakeProfit, setManualTakeProfit] = useState("5");
  const [manualMartingale, setManualMartingale] = useState(false);
  const [manualMultiplier, setManualMultiplier] = useState("2");
  const [manualMaxTrades, setManualMaxTrades] = useState("20");
  const [manualView, setManualView] = useState<BotView>({
    status: "idle",
    trades: 0,
    profit: 0,
    stake: 1,
    message: "",
  });
  const [liveDigitStats, setLiveDigitStats] = useState<LiveDigitStats | null>(null);
  const [tradeBusy, setTradeBusy] = useState(false);
  const [confirmLive, setConfirmLive] = useState(false);
  const [tradeMessage, setTradeMessage] = useState("");
  const [tradeError, setTradeError] = useState("");
  const [preparedProposal, setPreparedProposal] = useState<{
    id: string;
    askPrice: number;
    payout?: number;
    contract: DigitContract;
    barrier?: number;
    symbol: string;
    amount: number;
    duration: number;
  } | null>(null);
  const tradeClientRef = useRef<DerivClient | null>(null);
  const [scanResults, setScanResults] = useState<ScanResult[]>([]);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanError, setScanError] = useState("");
  const [scanCoverage, setScanCoverage] = useState("");
  const [scanCompleted, setScanCompleted] = useState(false);
  const [scanThreshold, setScanThreshold] = useState("78");
  const [scanSampleSize, setScanSampleSize] = useState("500");
  const [scanCategory, setScanCategory] = useState<ScanCategory>("ALL");
  const [botName, setBotName] = useState("My strategy");
  const [botStake, setBotStake] = useState("1");
  const [maxTrades, setMaxTrades] = useState("3");
  const [botMessage, setBotMessage] = useState("");
  const [masterParity, setMasterParity] = useState<"EVEN" | "ODD">("EVEN");
  const [masterStake, setMasterStake] = useState("1");
  const [masterTakeProfit, setMasterTakeProfit] = useState("5");
  const [masterStopLoss, setMasterStopLoss] = useState("5");
  const [masterTradeLimit, setMasterTradeLimit] = useState("20");
  const [masterMultiplier, setMasterMultiplier] = useState("2");
  const [masterView, setMasterView] = useState<BotView>({
    status: "idle",
    trades: 0,
    profit: 0,
    stake: 1,
    message: "",
  });
  const [confirmMasterLive, setConfirmMasterLive] = useState(false);
  const [confirmManualLive, setConfirmManualLive] = useState(false);
  const masterRunRef = useRef<Master5Run | null>(null);
  const manualRunRef = useRef<ManualRun | null>(null);
  const pendingManualConfigRef = useRef<ManualRunConfig | null>(null);
  const marketDataClientRef = useRef<DerivClient | null>(null);
  const liveTicksBySymbolRef = useRef<Record<string, Array<number | string>>>({});
  const selectedSymbolRef = useRef(symbol);

  const activeAccount = useMemo(
    () => accounts.find((account) => account.loginId === selectedLoginId),
    [accounts, selectedLoginId],
  );
  const isLive = Boolean(activeAccount && !activeAccount.isVirtual);
  const digitMarkets = markets.filter((market) => market.market === "synthetic_index");
  const masterIsActive =
    masterView.status === "starting" ||
    masterView.status === "running" ||
    masterView.status === "stopping";
  const manualIsActive =
    manualView.status === "starting" ||
    manualView.status === "running" ||
    manualView.status === "stopping";
  selectedSymbolRef.current = symbol;

  useEffect(() => {
    const timer = window.setTimeout(() => setShowIntro(false), 1400);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let client: DerivClient | undefined;

    void (async () => {
      try {
        client = await connectDeriv();
        if (cancelled) {
          client.close();
          return;
        }
        marketDataClientRef.current = client;
        const response = await client.request({ active_symbols: "brief" });
        const available = (response.active_symbols ?? [])
          .filter((market) => market.market === "synthetic_index")
          .map((market) => ({
            symbol: market.underlying_symbol,
            display_name: market.underlying_symbol_name,
            market: market.market,
            pip_size: market.pip_size,
          }));
        if (available.length === 0) {
          throw new Error("Deriv returned no active synthetic indices.");
        }
        if (cancelled) return;
        setMarkets(available);
        setSymbol((current) =>
          available.some((market) => market.symbol === current)
            ? current
            : available[0].symbol,
        );
        setMarketError("");
        const marketsBySymbol = new Map(available.map((market) => [market.symbol, market]));
        for (const market of available) {
          await client.subscribeTicks(market.symbol, (tick) => {
            if (typeof tick.quote !== "number") return;
            const currentMarket = tick.symbol
              ? marketsBySymbol.get(tick.symbol)
              : undefined;
            if (!currentMarket) return;
            const pipSize = tick.pip_size ?? currentMarket.pip_size;
            const digit = getLastDigit(tick.quote, pipSize);
            if (digit === null) return;

            const prices = liveTicksBySymbolRef.current[currentMarket.symbol] ?? [];
            prices.push(tick.quote);
            if (prices.length > 1000) prices.shift();
            liveTicksBySymbolRef.current[currentMarket.symbol] = prices;

            if (selectedSymbolRef.current === currentMarket.symbol) {
              const counts = Array.from({ length: 10 }, () => 0);
              for (const price of prices) {
                const recentDigit = getLastDigit(price, pipSize);
                if (recentDigit !== null) counts[recentDigit] += 1;
              }
              setLiveDigitStats({
                symbol: currentMarket.symbol,
                digit,
                quote: tick.quote,
                counts,
              });
            }

            const masterRun = masterRunRef.current;
            if (masterRun?.symbol === currentMarket.symbol) {
              handleMaster5Tick(masterRun, tick);
            }
          });
        }
      } catch (error) {
        client?.close();
        if (marketDataClientRef.current === client) marketDataClientRef.current = null;
        if (!cancelled) {
          setMarketError(
            error instanceof Error
              ? `Could not load the Deriv live market feed: ${error.message}`
              : "Could not load the Deriv live market feed.",
          );
        }
      } finally {
        if (!cancelled) setMarketLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (marketDataClientRef.current === client) marketDataClientRef.current = null;
      client?.close();
    };
  }, []);

  useEffect(() => {
    sessionStorage.removeItem("deriv_accounts");
    let cancelled = false;

    void fetch("/api/deriv/accounts", { cache: "no-store" })
      .then(async (response) => {
        let payload: {
          accounts?: unknown;
          error?: string;
        };
        try {
          payload = (await response.json()) as {
            accounts?: unknown;
            error?: string;
          };
        } catch {
          throw new Error("The server returned an invalid account response.");
        }

        if (response.status === 401) {
          if (!cancelled) {
            setAccounts([]);
            setSelectedLoginId("");
            setConnection("Not connected");
            if (payload.error && payload.error !== "Not connected to Deriv.") {
              setAccountError(payload.error);
            }
          }
          return;
        }
        if (!response.ok) {
          throw new Error(payload.error || "Could not load Deriv accounts.");
        }
        if (
          !Array.isArray(payload.accounts) ||
          !payload.accounts.every(isDerivAccount)
        ) {
          throw new Error("Deriv returned an invalid account list.");
        }

        if (cancelled) return;
        const parsed = payload.accounts as DerivAccount[];
        setAccounts(parsed);
        const preferred = parsed.find((account) => account.isVirtual) ?? parsed[0];
        setSelectedLoginId(preferred?.loginId ?? "");
        if (!preferred) setConnection("Not connected");
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setAccountError(
            error instanceof Error ? error.message : "Could not load Deriv accounts.",
          );
          setConnection("Connection error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeAccount) return;

    let cancelled = false;
    let client: DerivClient | undefined;
    setConnection("Connecting");

    void connectDeriv(activeAccount.accountId)
      .then(async (connectedClient) => {
        client = connectedClient;
        const balanceResponse = await client.request({ balance: 1 });
        if (cancelled) return;

        const accountBalance = balanceResponse.balance;
        setBalance(
          typeof accountBalance?.balance === "number"
            ? accountBalance.balance
            : null,
        );
        setCurrency(accountBalance?.currency ?? activeAccount.currency);

        setConnection("Connected");
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setConnection("Connection error");
          setAccountError(
            error instanceof Error ? error.message : "Could not connect to Deriv.",
          );
        }
      });

    return () => {
      cancelled = true;
      client?.close();
    };
  }, [activeAccount]);

  async function connectDerivAccount() {
    setAccountError("");
    try {
      const configResponse = await fetch("/api/deriv/oauth", {
        cache: "no-store",
      });
      let config: {
        clientId?: string;
        redirectUri?: string;
        error?: string;
      };
      try {
        config = (await configResponse.json()) as {
          clientId?: string;
          redirectUri?: string;
          error?: string;
        };
      } catch {
        throw new Error("The server returned invalid Deriv OAuth settings.");
      }
      if (!configResponse.ok) {
        throw new Error(config.error || "Deriv OAuth is not configured.");
      }
      if (!config.clientId || !config.redirectUri) {
        throw new Error("Deriv OAuth is not configured.");
      }

      const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
      const codeVerifier = base64UrlEncode(verifierBytes);
      const challengeDigest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(codeVerifier),
      );
      const codeChallenge = base64UrlEncode(new Uint8Array(challengeDigest));
      const state = crypto.randomUUID();

      sessionStorage.setItem("deriv_oauth_state", state);
      sessionStorage.setItem("deriv_pkce_verifier", codeVerifier);

      const authorizeUrl = new URL("https://auth.deriv.com/oauth2/auth");
      authorizeUrl.searchParams.set("response_type", "code");
      authorizeUrl.searchParams.set("client_id", config.clientId);
      authorizeUrl.searchParams.set("redirect_uri", config.redirectUri);
      authorizeUrl.searchParams.set("scope", "trade");
      authorizeUrl.searchParams.set("state", state);
      authorizeUrl.searchParams.set("code_challenge", codeChallenge);
      authorizeUrl.searchParams.set("code_challenge_method", "S256");
      window.location.assign(authorizeUrl.toString());
    } catch (error) {
      sessionStorage.removeItem("deriv_oauth_state");
      sessionStorage.removeItem("deriv_pkce_verifier");
      setAccountError(
        error instanceof Error
          ? error.message
          : "Could not start Deriv authorization.",
      );
    }
  }

  async function disconnect() {
    const activeRun = masterRunRef.current;
    if (activeRun) void stopMaster5(activeRun, "Bot stopped because the account was disconnected.");
    tradeClientRef.current?.close();
    tradeClientRef.current = null;
    setPreparedProposal(null);
    setConfirmLive(false);

    try {
      const response = await fetch("/api/deriv/oauth", { method: "DELETE" });
      if (!response.ok) throw new Error("Could not disconnect the Deriv session.");
    } catch (error) {
      setAccountError(
        error instanceof Error ? error.message : "Could not disconnect Deriv.",
      );
      return;
    }

    setAccounts([]);
    setSelectedLoginId("");
    setBalance(null);
    setConnection("Not connected");
    setAccountError("");
    setTradeMessage("");
    setScanResults([]);
  }

  async function reviewTrade() {
    if (masterIsActive || manualIsActive) {
      setTradeError("Stop the active strategy before preparing a separate trade.");
      return;
    }
    if (!activeAccount) {
      setTradeError("Connect a Deriv account before trading.");
      return;
    }
    const amount = Number(stake);
    if (!Number.isFinite(amount) || amount < 0.35 || amount > 1000) {
      setTradeError("Stake must be between 0.35 and 1,000.");
      return;
    }
    if (!digitMarkets.some((market) => market.symbol === symbol)) {
      setTradeError("Choose an available synthetic index.");
      return;
    }
    const barrierValue = Number(barrier);
    if (contractNeedsBarrier(contract) && !validDigitBarrier(contract, barrierValue)) {
      const expected = contract === "DIGITOVER" ? "0–8" : contract === "DIGITUNDER" ? "1–9" : "0–9";
      setTradeError(`Barrier must be a whole digit from ${expected}.`);
      return;
    }

    setTradeBusy(true);
    setTradeError("");
    setTradeMessage("");
    setPreparedProposal(null);
    tradeClientRef.current?.close();
    tradeClientRef.current = null;
    let client: DerivClient | undefined;
    try {
      client = await connectDeriv(activeAccount.accountId);
      const proposalRequest: Record<string, unknown> = {
        proposal: 1,
        amount,
        basis: "stake",
        contract_type: contract,
        currency: currency || activeAccount.currency,
        duration,
        duration_unit: "t",
        underlying_symbol: symbol,
      };
      if (contractNeedsBarrier(contract)) {
        proposalRequest.barrier = String(barrierValue);
      }
      const proposalResponse = await client.request(proposalRequest);
      const proposal = proposalResponse.proposal;
      if (!proposal?.id || typeof proposal.ask_price !== "number") {
        throw new Error("Deriv did not return a valid trade proposal.");
      }

      setPreparedProposal({
        id: proposal.id,
        askPrice: proposal.ask_price,
        payout: proposal.payout,
        contract,
        barrier: contractNeedsBarrier(contract) ? barrierValue : undefined,
        symbol,
        amount,
        duration,
      });
      tradeClientRef.current = client;
      client = undefined;
      setConfirmLive(true);
    } catch (error) {
      setTradeError(error instanceof Error ? error.message : "Could not prepare a trade proposal.");
    } finally {
      client?.close();
      setTradeBusy(false);
    }
  }

  async function submitTrade() {
    const client = tradeClientRef.current;
    if (!client || !preparedProposal) {
      setTradeError("Trade proposal is no longer available. Review it again.");
      setConfirmLive(false);
      setPreparedProposal(null);
      return;
    }

    setTradeBusy(true);
    setTradeError("");
    try {
      const buyResponse = await client.request({
        buy: preparedProposal.id,
        price: preparedProposal.askPrice,
      });
      const contractId = buyResponse.buy?.contract_id;
      setTradeMessage(
        contractId
          ? `Trade placed. Contract #${contractId} · ${contractLabel(preparedProposal.contract, preparedProposal.barrier ?? "")} · ${preparedProposal.symbol}.`
          : "Trade request sent to Deriv.",
      );
      const balanceResponse = await client.request({ balance: 1 });
      if (typeof balanceResponse.balance?.balance === "number") {
        setBalance(balanceResponse.balance.balance);
      }
    } catch (error) {
      setTradeError(error instanceof Error ? error.message : "Trade could not be placed.");
    } finally {
      client.close();
      tradeClientRef.current = null;
      setPreparedProposal(null);
      setTradeBusy(false);
      setConfirmLive(false);
    }
  }

  function cancelTradeReview() {
    tradeClientRef.current?.close();
    tradeClientRef.current = null;
    setPreparedProposal(null);
    setConfirmLive(false);
  }

  function finishManualRun(
    run: ManualRun,
    message: string,
    status: "stopped" | "error" = "stopped",
  ) {
    run.running = false;
    run.inTrade = false;
    run.client?.close();
    if (manualRunRef.current === run) manualRunRef.current = null;
    setManualView({
      status,
      trades: run.trades,
      profit: run.profit,
      stake: run.currentStake,
      message,
    });
  }

  function stopManualRun(
    run: ManualRun,
    message: string,
    status: "stopped" | "error" = "stopped",
  ) {
    run.running = false;
    run.stopMessage = message;
    if (run.inTrade) {
      setManualView({
        status: "stopping",
        trades: run.trades,
        profit: run.profit,
        stake: run.currentStake,
        message: "Stopping after the open contract settles.",
      });
      return;
    }
    finishManualRun(run, message, status);
  }

  async function executeManualRun(run: ManualRun) {
    if (!run.client) return;
    while (run.running) {
      const remainingLossBudget = run.stopLoss + run.profit;
      if (run.currentStake > Math.min(1000, remainingLossBudget)) {
        finishManualRun(run, "Stopped before the next entry: stake exceeds the remaining stop-loss budget.");
        return;
      }

      try {
        const proposalRequest: Record<string, unknown> = {
          proposal: 1,
          amount: run.currentStake,
          basis: "stake",
          contract_type: run.contract,
          currency: currency || activeAccount?.currency || "USD",
          duration: run.duration,
          duration_unit: "t",
          underlying_symbol: run.symbol,
        };
        if (contractNeedsBarrier(run.contract)) {
          proposalRequest.barrier = String(run.barrier);
        }
        const proposalResponse = await run.client.request(proposalRequest);
        const proposal = proposalResponse.proposal;
        if (!proposal?.id || typeof proposal.ask_price !== "number") {
          throw new Error("Deriv did not return a valid manual-trade proposal.");
        }
        if (!run.running) {
          finishManualRun(run, run.stopMessage || "Stopped before the next entry.");
          return;
        }

        run.inTrade = true;
        const buyResponse = await run.client.request({
          buy: proposal.id,
          price: proposal.ask_price,
        });
        const contractId = buyResponse.buy?.contract_id;
        if (typeof contractId !== "number") {
          run.inTrade = false;
          throw new Error("Deriv did not confirm the manual trade.");
        }
        run.trades += 1;
        setManualView({
          status: "running",
          trades: run.trades,
          profit: run.profit,
          stake: run.currentStake,
          message: `Trade ${run.trades} opened: ${contractLabel(run.contract, run.barrier ?? "")} · ${run.duration} tick(s). Waiting for settlement.`,
        });
        const tradeProfit = await run.client.waitForContract(contractId);
        run.inTrade = false;
        run.profit += tradeProfit;
        run.currentStake =
          tradeProfit < 0 && run.martingaleEnabled
            ? run.currentStake * run.multiplier
            : run.stake;

        if (run.profit >= run.takeProfit) {
          finishManualRun(run, `Take-profit reached: +${run.profit.toFixed(2)} ${currency || activeAccount?.currency || ""}.`);
          return;
        }
        if (run.profit <= -run.stopLoss) {
          finishManualRun(run, `Stop-loss reached: ${run.profit.toFixed(2)} ${currency || activeAccount?.currency || ""}.`);
          return;
        }
        if (run.trades >= run.maxTrades) {
          finishManualRun(run, `Trade limit reached (${run.maxTrades}). Session P/L: ${run.profit.toFixed(2)}.`);
          return;
        }
        if (!run.running) {
          finishManualRun(run, run.stopMessage || "Stopped by you.");
          return;
        }
        setManualView({
          status: "running",
          trades: run.trades,
          profit: run.profit,
          stake: run.currentStake,
          message: `Last result ${tradeProfit >= 0 ? "+" : ""}${tradeProfit.toFixed(2)}. Next stake: ${run.currentStake.toFixed(2)}.`,
        });
      } catch (error) {
        const tradeWasInFlight = run.inTrade;
        run.inTrade = false;
        if (!run.running && !tradeWasInFlight) {
          finishManualRun(run, run.stopMessage || "Stopped by you.");
          return;
        }
        finishManualRun(
          run,
          error instanceof Error ? error.message : "Manual strategy stopped after a Deriv error.",
          "error",
        );
        return;
      }
    }
  }

  async function launchManualRun(config: ManualRunConfig) {
    if (!activeAccount || manualRunRef.current) return;
    const run: ManualRun = {
      ...config,
      running: true,
      inTrade: false,
      currentStake: config.stake,
      trades: 0,
      profit: 0,
      stopMessage: "",
    };
    manualRunRef.current = run;
    setManualView({
      status: "starting",
      trades: 0,
      profit: 0,
      stake: run.currentStake,
      message: `Connecting to ${isLive ? "real" : "demo"} account…`,
    });
    setConfirmManualLive(false);
    pendingManualConfigRef.current = null;

    try {
      run.client = await connectDeriv(activeAccount.accountId);
      if (!run.running) {
        run.client.close();
        return;
      }
      setManualView({
        status: "running",
        trades: 0,
        profit: 0,
        stake: run.currentStake,
        message: `Running ${contractLabel(run.contract, run.barrier ?? "")} on ${run.symbol}; limits are active.`,
      });
      void executeManualRun(run);
    } catch (error) {
      finishManualRun(
        run,
        error instanceof Error ? error.message : "Could not start the manual strategy.",
        "error",
      );
    }
  }

  function requestManualStart(overrides: Partial<ManualRunConfig> = {}) {
    if (masterIsActive || confirmLive || confirmMasterLive || tradeBusy) {
      setManualView((view) => ({ ...view, status: "error", message: "Finish or cancel the current trade review before starting a strategy." }));
      return;
    }
    if (!activeAccount) {
      setManualView((view) => ({ ...view, status: "error", message: "Connect a Deriv account before starting a manual strategy." }));
      return;
    }
    if (manualRunRef.current) return;

    const selectedContract = overrides.contract ?? contract;
    const selectedBarrier = overrides.barrier ?? Number(barrier);
    const config: ManualRunConfig = {
      symbol: overrides.symbol ?? symbol,
      contract: selectedContract,
      barrier: contractNeedsBarrier(selectedContract) ? selectedBarrier : undefined,
      stake: overrides.stake ?? Number(stake),
      stopLoss: overrides.stopLoss ?? Number(manualStopLoss),
      takeProfit: overrides.takeProfit ?? Number(manualTakeProfit),
      martingaleEnabled: overrides.martingaleEnabled ?? manualMartingale,
      multiplier: overrides.multiplier ?? Number(manualMultiplier),
      duration: overrides.duration ?? duration,
      maxTrades: overrides.maxTrades ?? Number(manualMaxTrades),
    };
    if (!digitMarkets.some((market) => market.symbol === config.symbol)) {
      setManualView((view) => ({ ...view, status: "error", message: "Choose an available Volatility or Jump index." }));
      return;
    }
    if (!Number.isFinite(config.stake) || config.stake < 0.35 || config.stake > 1000) {
      setManualView((view) => ({ ...view, status: "error", message: "Stake must be between 0.35 and 1,000." }));
      return;
    }
    if (
      contractNeedsBarrier(config.contract) &&
      !validDigitBarrier(config.contract, config.barrier ?? Number.NaN)
    ) {
      setManualView((view) => ({ ...view, status: "error", message: "Enter a valid barrier digit for the selected contract." }));
      return;
    }
    if (!Number.isFinite(config.stopLoss) || config.stopLoss <= 0 || !Number.isFinite(config.takeProfit) || config.takeProfit <= 0) {
      setManualView((view) => ({ ...view, status: "error", message: "Stop Loss and Take Profit must be positive." }));
      return;
    }
    if (config.stake > config.stopLoss) {
      setManualView((view) => ({ ...view, status: "error", message: "Stop Loss must cover at least the starting stake." }));
      return;
    }
    if (
      config.martingaleEnabled &&
      (!Number.isFinite(config.multiplier) || config.multiplier <= 1 || config.multiplier > 5)
    ) {
      setManualView((view) => ({ ...view, status: "error", message: "Martingale multiplier must be greater than 1 and no more than 5." }));
      return;
    }
    if (!TICK_DURATIONS.includes(config.duration)) {
      setManualView((view) => ({ ...view, status: "error", message: "Choose a supported duration from 1, 2, 5, or 10 ticks." }));
      return;
    }
    if (!Number.isInteger(config.maxTrades) || config.maxTrades < 1 || config.maxTrades > 100) {
      setManualView((view) => ({ ...view, status: "error", message: "Trade limit must be between 1 and 100." }));
      return;
    }

    setSymbol(config.symbol);
    setContract(config.contract);
    setBarrier(String(config.barrier ?? 5));
    setStake(String(config.stake));
    setDuration(config.duration);
    pendingManualConfigRef.current = config;
    if (isLive) setConfirmManualLive(true);
    else void launchManualRun(config);
  }

  function loadScanResultToBuilder(result: ScanResult) {
    const nextContract = contractFromScanResult(result);
    setSymbol(result.symbol);
    setContract(nextContract);
    setBarrier(String(result.barrier ?? 5));
    setBotName(`AI scan ${result.symbol} ${result.contract}`);
    setBotStake(stake);
    setMaxTrades(manualMaxTrades);
    document.getElementById("bot-builder")?.scrollIntoView({ behavior: "smooth" });
    setBotMessage(`Loaded ${result.symbol} · ${result.contract}${result.barrier === undefined ? "" : ` ${result.barrier}`} from live digit statistics. Review risk settings before saving.`);
  }

  async function runScanner() {
    const syntheticMarkets = markets.filter(
      (market) =>
        market.market === "synthetic_index" &&
        /volatility|jump/i.test(market.display_name),
    );
    if (syntheticMarkets.length === 0) {
      setScanError("No live Volatility or Jump indices are currently available from Deriv.");
      return;
    }

    setScanBusy(true);
    setScanError("");
    setScanCoverage("");
    setScanResults([]);
    setScanCompleted(false);
    try {
      const sampleSize = Number(scanSampleSize);
      const readyMarkets = syntheticMarkets.filter(
        (market) => (liveTicksBySymbolRef.current[market.symbol]?.length ?? 0) >= 20,
      );
      if (readyMarkets.length === 0) {
        throw new Error("The live feed is warming up. Wait until at least 20 ticks have arrived for an index, then scan again.");
      }
      const results = readyMarkets.map((market) => {
        const prices = liveTicksBySymbolRef.current[market.symbol] ?? [];
        return scanDigitContracts(market, prices.slice(-sampleSize), market.pip_size);
      });
      setScanCoverage(
        readyMarkets.length === syntheticMarkets.length
          ? `Live statistics from ${readyMarkets.length} Volatility and Jump indices.`
          : `Live statistics for ${readyMarkets.length} of ${syntheticMarkets.length} indices; remaining feeds need at least 20 ticks.`,
      );
      setScanResults(
        results
          .flat()
          .sort((left, right) => right.hitRate - left.hitRate || left.symbol.localeCompare(right.symbol)),
      );
      setScanCompleted(true);
    } catch (error) {
      setScanError(error instanceof Error ? error.message : "Market scan failed.");
    } finally {
      setScanBusy(false);
    }
  }

  function saveBot() {
    const amount = Number(botStake);
    const tradeLimit = Number(maxTrades);
    if (!botName.trim() || !Number.isFinite(amount) || amount < 0.35 || amount > 1000) {
      setBotMessage("Enter a name and a stake between 0.35 and 1,000.");
      return;
    }
    if (!Number.isInteger(tradeLimit) || tradeLimit < 1 || tradeLimit > 100) {
      setBotMessage("Set a trade limit between 1 and 100.");
      return;
    }
    if (contractNeedsBarrier(contract) && !validDigitBarrier(contract, Number(barrier))) {
      setBotMessage("Enter a valid barrier digit for the selected contract.");
      return;
    }
    if (
      !Number.isFinite(Number(manualStopLoss)) ||
      Number(manualStopLoss) <= 0 ||
      amount > Number(manualStopLoss) ||
      !Number.isFinite(Number(manualTakeProfit)) ||
      Number(manualTakeProfit) <= 0 ||
      (manualMartingale &&
        (!Number.isFinite(Number(manualMultiplier)) ||
          Number(manualMultiplier) <= 1 ||
          Number(manualMultiplier) > 5))
    ) {
      setBotMessage("Enter positive Stop Loss and Take Profit values, set Stop Loss at least equal to the stake, and use a Martingale multiplier from 1.01 to 5 when enabled.");
      return;
    }
    const config: BotConfig = {
      name: botName.trim(),
      symbol,
      contract,
      barrier: contractNeedsBarrier(contract) ? Number(barrier) : undefined,
      stake: amount,
      maxTrades: tradeLimit,
      stopLoss: Number(manualStopLoss),
      takeProfit: Number(manualTakeProfit),
      martingaleEnabled: manualMartingale,
      multiplier: Number(manualMultiplier),
      duration,
    };
    localStorage.setItem("deriv_bot_config", JSON.stringify(config));
    setBotMessage(`${config.name} saved on this device. It will not place trades automatically.`);
  }

  function applyBot(bot: BotConfig) {
    if (bot.name === "Master 5") {
      setSymbol(bot.symbol);
      setMasterStake(String(bot.stake));
      setMasterParity("EVEN");
      document.getElementById("master-5-builder")?.scrollIntoView({ behavior: "smooth" });
      setMasterView((view) => ({
        ...view,
        message: "Master 5 loaded. Choose the target parity and review the risk limits.",
      }));
      return;
    }
    setBotName(bot.name);
    setSymbol(bot.symbol);
    setContract(bot.contract);
    setBarrier(String(bot.barrier ?? 5));
    setBotStake(String(bot.stake));
    setStake(String(bot.stake));
    setMaxTrades(String(bot.maxTrades));
    setManualMaxTrades(String(bot.maxTrades));
    if (bot.stopLoss !== undefined) setManualStopLoss(String(bot.stopLoss));
    if (bot.takeProfit !== undefined) setManualTakeProfit(String(bot.takeProfit));
    if (bot.martingaleEnabled !== undefined) setManualMartingale(bot.martingaleEnabled);
    if (bot.multiplier !== undefined) setManualMultiplier(String(bot.multiplier));
    if (bot.duration !== undefined) setDuration(bot.duration);
    document.getElementById("bot-builder")?.scrollIntoView({ behavior: "smooth" });
    setBotMessage(`${bot.name} template loaded. Review settings before saving.`);
  }

  function updateMasterView(run: Master5Run, message: string, status?: BotStatus) {
    setMasterView({
      status: status ?? (run.running ? "running" : "stopped"),
      trades: run.trades,
      profit: run.profit,
      stake: run.currentStake,
      message,
    });
  }

  function stopMaster5(
    run: Master5Run,
    message: string,
    status: "stopped" | "error" = "stopped",
  ) {
    run.running = false;
    run.stopMessage = message;
    if (run.inTrade) {
      updateMasterView(run, "Stopping after the open contract settles.", "stopping");
      return;
    }
    run.client?.close();
    if (masterRunRef.current === run) masterRunRef.current = null;
    updateMasterView(run, message, status);
  }

  async function placeMaster5Entry(run: Master5Run) {
    if (!run.client || !run.running) {
      run.inTrade = false;
      return;
    }

    const lossBudgetRemaining = run.stopLoss + run.profit;
    if (run.currentStake > Math.min(1000, lossBudgetRemaining)) {
      run.inTrade = false;
      stopMaster5(
        run,
        "Stopped before the next entry: the doubled stake would exceed the remaining loss limit.",
      );
      return;
    }

    try {
      const proposalResponse = await run.client.request({
        proposal: 1,
        amount: run.currentStake,
        basis: "stake",
        contract_type: run.target === "EVEN" ? "DIGITEVEN" : "DIGITODD",
        currency: run.currency,
        duration: 1,
        duration_unit: "t",
        underlying_symbol: run.symbol,
      });
      const proposal = proposalResponse.proposal;
      if (!proposal?.id || typeof proposal.ask_price !== "number") {
        throw new Error("Deriv did not return a valid digit-contract proposal.");
      }
      if (!run.running) {
        run.inTrade = false;
        stopMaster5(run, run.stopMessage || "Bot stopped before entry.");
        return;
      }

      const buyResponse = await run.client.request({
        buy: proposal.id,
        price: proposal.ask_price,
      });
      const contractId = buyResponse.buy?.contract_id;
      if (typeof contractId !== "number") {
        throw new Error("Deriv did not confirm the bot's contract purchase.");
      }

      run.trades += 1;
      updateMasterView(
        run,
        `Trade ${run.trades} opened: ${run.target} · ${run.currency} ${run.currentStake.toFixed(2)}. Waiting for result.`,
      );
      const profit = await run.client.waitForContract(contractId);
      run.profit += profit;
      run.currentStake = profit < 0
        ? run.currentStake * run.multiplier
        : run.baseStake;
      run.inTrade = false;

      if (run.profit >= run.takeProfit) {
        stopMaster5(run, `Take-profit reached: +${run.profit.toFixed(2)} ${run.currency}.`);
        return;
      }
      if (run.profit <= -run.stopLoss) {
        stopMaster5(run, `Stop-loss reached: ${run.profit.toFixed(2)} ${run.currency}.`);
        return;
      }
      if (run.trades >= run.tradeLimit) {
        stopMaster5(run, `Trade limit reached (${run.tradeLimit}). Session P/L: ${run.profit.toFixed(2)} ${run.currency}.`);
        return;
      }

      const nextLossBudget = run.stopLoss + run.profit;
      if (run.currentStake > Math.min(1000, nextLossBudget)) {
        stopMaster5(
          run,
          `Stopped before the next entry: the next stake exceeds the remaining loss limit. Session P/L: ${run.profit.toFixed(2)} ${run.currency}.`,
        );
        return;
      }
      if (!run.running) {
        stopMaster5(run, run.stopMessage || "Bot stopped.");
        return;
      }
      updateMasterView(
        run,
        `Last result ${profit >= 0 ? "+" : ""}${profit.toFixed(2)} ${run.currency}. Next stake: ${run.currency} ${run.currentStake.toFixed(2)}.`,
      );
    } catch (error) {
      run.inTrade = false;
      stopMaster5(
        run,
        error instanceof Error ? error.message : "Master 5 stopped after a Deriv error.",
        "error",
      );
    }
  }

  function handleMaster5Tick(run: Master5Run, tick: DerivTick) {
    if (!run.running || run.inTrade || typeof tick.quote !== "number") return;
    const precision = tick.pip_size ?? 0;
    if (!Number.isInteger(precision) || precision < 0 || precision > 10) return;
    const digits = tick.quote.toFixed(precision).replace(".", "");
    const lastDigit = Number(digits.at(-1));
    if (!Number.isInteger(lastDigit) || lastDigit < 0 || lastDigit > 9) return;

    const digitParity = lastDigit % 2 === 0 ? "EVEN" : "ODD";
    if (digitParity === run.target) {
      run.oppositeStreak = 0;
      return;
    }

    run.oppositeStreak += 1;
    if (run.oppositeStreak < 5) return;
    run.oppositeStreak = 0;
    run.inTrade = true;
    void placeMaster5Entry(run);
  }

  function validateMaster5() {
    const baseStake = Number(masterStake);
    const takeProfit = Number(masterTakeProfit);
    const stopLoss = Number(masterStopLoss);
    const tradeLimit = Number(masterTradeLimit);
    const multiplier = Number(masterMultiplier);
    if (!activeAccount) {
      setMasterView((view) => ({ ...view, status: "error", message: "Connect a Deriv account before starting Master 5." }));
      return false;
    }
    if (!Number.isFinite(baseStake) || baseStake < 0.35 || baseStake > 1000) {
      setMasterView((view) => ({ ...view, status: "error", message: "Starting stake must be between 0.35 and 1,000." }));
      return false;
    }
    if (!Number.isFinite(takeProfit) || takeProfit <= 0 || !Number.isFinite(stopLoss) || stopLoss <= 0 || baseStake > stopLoss) {
      setMasterView((view) => ({ ...view, status: "error", message: "Profit and loss limits must be positive, and stop loss must cover at least the starting stake." }));
      return false;
    }
    if (!Number.isInteger(tradeLimit) || tradeLimit < 1 || tradeLimit > 100) {
      setMasterView((view) => ({ ...view, status: "error", message: "Trade limit must be between 1 and 100." }));
      return false;
    }
    if (!Number.isFinite(multiplier) || multiplier <= 1 || multiplier > 5) {
      setMasterView((view) => ({ ...view, status: "error", message: "Martingale multiplier must be greater than 1 and no more than 5." }));
      return false;
    }
    if (!digitMarkets.some((market) => market.symbol === symbol)) {
      setMasterView((view) => ({ ...view, status: "error", message: "Choose an available synthetic index." }));
      return false;
    }
    return true;
  }

  async function launchMaster5() {
    if (!validateMaster5() || !activeAccount || masterRunRef.current) return;
    const run: Master5Run = {
      running: true,
      inTrade: false,
      target: masterParity,
      symbol,
      currency: currency || activeAccount.currency || "USD",
      baseStake: Number(masterStake),
      currentStake: Number(masterStake),
      multiplier: Number(masterMultiplier),
      takeProfit: Number(masterTakeProfit),
      stopLoss: Number(masterStopLoss),
      tradeLimit: Number(masterTradeLimit),
      trades: 0,
      profit: 0,
      oppositeStreak: 0,
      stopMessage: "",
    };
    masterRunRef.current = run;
    setMasterView({
      status: "starting",
      trades: 0,
      profit: 0,
      stake: run.baseStake,
      message: `Connecting to ${isLive ? "real" : "demo"} account…`,
    });

    try {
      const client = await connectDeriv(activeAccount.accountId);
      run.client = client;
      if (!run.running) {
        client.close();
        return;
      }
      setMasterView({
        status: "running",
        trades: 0,
        profit: 0,
        stake: run.baseStake,
        message: `Waiting for five consecutive ${run.target === "EVEN" ? "odd" : "even"} last digits on ${run.symbol}.`,
      });
      if (!marketDataClientRef.current) {
        await client.subscribeTicks(run.symbol, (tick) => handleMaster5Tick(run, tick));
      }
    } catch (error) {
      run.running = false;
      run.client?.close();
      if (!run.running && masterRunRef.current !== run) return;
      if (masterRunRef.current === run) masterRunRef.current = null;
      updateMasterView(
        run,
        error instanceof Error ? error.message : "Could not start Master 5.",
        "error",
      );
    }
  }

  function requestMaster5Start() {
    if (masterIsActive || manualIsActive || confirmLive || confirmManualLive || tradeBusy || !validateMaster5()) return;
    if (isLive) setConfirmMasterLive(true);
    else void launchMaster5();
  }

  const categorizedScanResults = scanResults.filter((result) => {
    if (scanCategory === "PARITY") return result.contract === "Even" || result.contract === "Odd";
    if (scanCategory === "OVER_UNDER") return result.contract === "Over" || result.contract === "Under";
    if (scanCategory === "MATCHES_DIFFERS") return result.contract === "Matches" || result.contract === "Differs";
    return true;
  });
  const bestScanResult = categorizedScanResults[0];
  const visibleScanResults = categorizedScanResults
    .filter((result) => result.hitRate >= Number(scanThreshold))
    .slice(0, 20);

  const selectedMarket = markets.find((market) => market.symbol === symbol);

  if (showIntro) {
    return (
      <main className="intro-screen" aria-live="polite">
        <div className="intro-card">
          <span className="intro-brand-mark">B</span>
          <p className="intro-brand">Burnitor<span>Trader</span></p>
          <div className="intro-spinner" role="status" aria-label="Loading BurnitorTrader" />
          <p className="intro-message">Loading your trading workspace…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="dashboard">
      <aside className="sidebar">
        <a className="brand" href="#overview" aria-label="BurnitorTrader home">
          <span className="brand-mark">B</span>
          <span>Burnitor<span className="brand-light">Trader</span></span>
        </a>
        <p className="side-label">WORKSPACE</p>
        <nav className="nav-links" aria-label="Dashboard">
          <a className="nav-link active" href="#overview"><span>◈</span> Overview</a>
          <a className="nav-link" href="#trade"><span>↗</span> Trade</a>
          <a className="nav-link" href="#bot-builder"><span>⚙</span> Bot builder</a>
          <a className="nav-link" href="#analysis"><span>⌁</span> Analysis tools</a>
          <a className="nav-link" href="#free-bots"><span>✦</span> Free bots</a>
          <a
            className="nav-link"
            href="#scanner"
            onClick={() => {
              window.setTimeout(() => void runScanner(), 0);
            }}
          >
            <span>⌕</span> AI scanner
          </a>
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card">
          <span className="help-icon">i</span>
          <div><strong>Stay in control</strong><small>Review strategy limits before starting automation.</small></div>
          </div>
          {activeAccount ? (
          <button className="text-button" type="button" disabled={masterIsActive || manualIsActive} onClick={disconnect}>Disconnect account</button>
          ) : (
            <button className="text-button" type="button" onClick={connectDerivAccount}>Connect Deriv</button>
          )}
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="breadcrumb">Workspace <span>/</span> Overview</div>
          <div className="topbar-actions">
            <span className={`connection-pill ${connection === "Connected" ? "online" : ""}`}>
              <span className="connection-dot" /> {connection}
            </span>
            {accounts.length > 0 && (
              <select
                className="account-select"
                aria-label="Select Deriv account"
                value={selectedLoginId}
                disabled={masterIsActive || manualIsActive || confirmLive || confirmMasterLive || confirmManualLive}
                onChange={(event) => {
                  setSelectedLoginId(event.target.value);
                  setAccountError("");
                }}
              >
                {accounts.map((account) => (
                  <option key={account.loginId} value={account.loginId}>
                    {account.isVirtual ? "Demo" : "Real"} · {account.loginId}
                  </option>
                ))}
              </select>
            )}
            <button className="top-connect" type="button" disabled={masterIsActive || manualIsActive || confirmLive || confirmMasterLive || confirmManualLive} onClick={connectDerivAccount}>
              {activeAccount ? "Add account" : "Connect Deriv"}
            </button>
          </div>
        </header>

        <div className="content">
          <section className="welcome-banner" id="overview">
            <div className="banner-copy">
              <span className="banner-kicker">YOUR MARKETS. YOUR RULES.</span>
              <h1>Make your next move <span>with clarity.</span></h1>
              <p>Trade Deriv markets, explore strategy templates, and review market signals in one place.</p>
              <a className="banner-button" href="#trade">Open trade ticket <span>→</span></a>
            </div>
            <div className="banner-art" aria-hidden="true">
              <div className="art-ring ring-one" />
              <div className="art-ring ring-two" />
              <div className="art-bar bar-one" />
              <div className="art-bar bar-two" />
              <div className="art-bar bar-three" />
              <div className="art-bar bar-four" />
              <div className="gold-orb" />
            </div>
            <span className="banner-sheen" />
          </section>

          {(accountError || marketError || connection === "Not connected") && (
            <div className={`notice ${accountError || marketError ? "notice-error" : ""}`}>
              <span>{accountError || marketError || "Connect a Deriv account to load your balance and place trades. Market scanning is available without login."}</span>
              {!activeAccount && !accountError && !marketError && <button type="button" onClick={connectDerivAccount}>Connect account</button>}
              {(accountError || marketError) && <button type="button" onClick={() => { setAccountError(""); setMarketError(""); }} aria-label="Dismiss error">×</button>}
            </div>
          )}

          <section className="metrics-grid" aria-label="Account overview">
            <article className="metric-card">
              <div className="metric-heading"><span>Account balance</span><span className="metric-icon gold">¤</span></div>
              <strong>{balance === null ? "—" : `${currency} ${balance.toFixed(2)}`}</strong>
              <small>{activeAccount ? `${isLive ? "Real" : "Demo"} account · ${activeAccount.loginId}` : "Connect an account to view balance"}</small>
            </article>
            <article className="metric-card">
              <div className="metric-heading"><span>Trading mode</span><span className={`mode-tag ${isLive ? "live" : "demo"}`}>{activeAccount ? (isLive ? "LIVE" : "DEMO") : "OFFLINE"}</span></div>
              <strong>{activeAccount ? (isLive ? "Real account" : "Demo account") : "Not connected"}</strong>
              <small>{isLive ? "Live orders can lose money." : "Use demo to test your setup."}</small>
            </article>
            <article className="metric-card">
              <div className="metric-heading"><span>Available synthetic indices</span><span className="metric-icon blue">⌁</span></div>
              <strong>{markets.length}</strong>
              <small>Includes Volatility and Jump indices</small>
            </article>
          </section>

          <div className="work-grid">
            <section className="panel trade-panel" id="trade">
              <div className="panel-heading">
                <div><span className="section-kicker">EXECUTION</span><h2>Trade ticket</h2></div>
                <span className={`mode-tag ${isLive ? "live" : "demo"}`}>{isLive ? "LIVE ACCOUNT" : "DEMO MODE"}</span>
              </div>
              <label className="field-label" htmlFor="market">Market</label>
              <select id="market" className="field" value={symbol} onChange={(event) => setSymbol(event.target.value)}>
                {digitMarkets.map((market) => <option key={market.symbol} value={market.symbol}>{market.display_name} ({market.symbol})</option>)}
              </select>
              <div className="trade-fields">
                <label className="field-wrap"><span className="field-label">Stake ({currency || "USD"})</span><input className="field" type="number" min="0.35" max="1000" step="0.01" value={stake} onChange={(event) => setStake(event.target.value)} /></label>
                <label className="field-wrap">
                  <span className="field-label">Digit contract</span>
                  <select className="field" value={contract} onChange={(event) => setContract(event.target.value as DigitContract)}>
                    {DIGIT_CONTRACT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                {contractNeedsBarrier(contract) && (
                  <label className="field-wrap">
                    <span className="field-label">Barrier digit</span>
                    <input
                      className="field"
                      type="number"
                      min={contract === "DIGITOVER" ? 0 : contract === "DIGITUNDER" ? 1 : 0}
                      max={contract === "DIGITOVER" ? 8 : 9}
                      step="1"
                      value={barrier}
                      onChange={(event) => setBarrier(event.target.value)}
                    />
                  </label>
                )}
                <label className="field-wrap"><span className="field-label">Duration</span><select className="field" value={duration} onChange={(event) => setDuration(Number(event.target.value))}>{TICK_DURATIONS.map((ticks) => <option key={ticks} value={ticks}>{ticks} {ticks === 1 ? "Tick" : "Ticks"}</option>)}</select></label>
              </div>
              <div className="trade-summary"><span>Contract</span><strong>{selectedMarket?.display_name ?? symbol} · {contractLabel(contract, barrier)}</strong><span>Stake limit</span><strong>0.35 – 1,000</strong></div>
              <button
                className={`execute-button ${isLive ? "execute-live" : ""}`}
                type="button"
                disabled={!activeAccount || tradeBusy || masterIsActive || manualIsActive || digitMarkets.length === 0}
                onClick={() => {
                  setTradeError("");
                  void reviewTrade();
                }}
              >
                {tradeBusy ? "Getting Deriv proposal…" : isLive ? "Review live digit trade" : "Review demo digit trade"}
              </button>
              <p className="fine-print">Review a single trade proposal here. For automatic repeat trades with session limits, use Manual Trade below.</p>
              {tradeError && <p className="feedback error-text" role="alert">{tradeError}</p>}
              {tradeMessage && <p className="feedback success-text" role="status">{tradeMessage}</p>}
            </section>

            <section className="panel scanner-panel" id="scanner">
              <div className="panel-heading">
                <div><span className="section-kicker">MARKET WATCH</span><h2>AI scanner</h2></div>
                <span className="live-indicator"><i /> {marketLoading ? "LOADING MARKETS" : marketError ? "FALLBACK MARKETS" : "LIVE DATA"}</span>
              </div>
              <p className="panel-description">Compare live Volatility and Jump indices using recent ticks from the shared feed. No account login is needed to scan.</p>
              <div className="scanner-filters">
                <label className="field-wrap">
                  <span className="field-label">Minimum observed frequency</span>
                  <select className="field" value={scanThreshold} onChange={(event) => setScanThreshold(event.target.value)}>
                    <option value="78">78% or higher</option>
                    <option value="80">80% or higher</option>
                  </select>
                </label>
                <label className="field-wrap">
                  <span className="field-label">Recent ticks per index</span>
                  <select className="field" value={scanSampleSize} onChange={(event) => setScanSampleSize(event.target.value)}>
                    <option value="100">100 ticks</option>
                    <option value="500">500 ticks</option>
                    <option value="1000">1,000 ticks</option>
                  </select>
                </label>
                <label className="field-wrap">
                  <span className="field-label">Contract group</span>
                  <select className="field" value={scanCategory} onChange={(event) => setScanCategory(event.target.value as ScanCategory)}>
                    <option value="ALL">All types</option>
                    <option value="PARITY">Even / Odd</option>
                    <option value="OVER_UNDER">Over / Under</option>
                    <option value="MATCHES_DIFFERS">Matches / Differs</option>
                  </select>
                </label>
              </div>
              <button className="scan-button" type="button" disabled={scanBusy} onClick={() => void runScanner()}>
                {scanBusy ? <><span className="spinner" /> Scanning live indices…</> : "Scan live markets"}
              </button>
              {scanError && <p className="feedback error-text" role="alert">{scanError}</p>}
              {scanCompleted && bestScanResult && (
                <div className="best-scan-result">
                  <span className="best-scan-label">BEST CURRENT LIVE FREQUENCY · {bestScanResult.hitRate.toFixed(1)}%</span>
                  <strong>{bestScanResult.name} · {bestScanResult.contract}{bestScanResult.barrier === undefined ? "" : ` ${bestScanResult.barrier}`}</strong>
                  <span>{bestScanResult.hitRate.toFixed(1)}% ({bestScanResult.hits}/{bestScanResult.sampleSize} ticks)</span>
                  <div className="scan-actions">
                    <button className="execute-button" type="button" disabled={!activeAccount || manualIsActive || masterIsActive} onClick={() => requestManualStart({
                      symbol: bestScanResult.symbol,
                      contract: contractFromScanResult(bestScanResult),
                      barrier: bestScanResult.barrier,
                    })}>Run recommendation</button>
                    <button className="outline-button" type="button" onClick={() => loadScanResultToBuilder(bestScanResult)}>Load to Bot Builder</button>
                  </div>
                </div>
              )}
              {scanCoverage && <p className="feedback" role="status">{scanCoverage}</p>}
              {visibleScanResults.length > 0 ? (
                <div className="scan-list">
                  {visibleScanResults.map((result, index) => (
                    <div className="scan-row" key={`${result.symbol}-${result.contract}-${result.barrier ?? "none"}`}>
                      <span className="scan-rank">{index + 1}</span>
                      <span className="scan-symbol"><strong>{result.symbol}</strong><small>{result.name}</small></span>
                      <span className="signal contract-signal">{result.contract}{result.barrier === undefined ? "" : ` ${result.barrier}`}</span>
                      <span className="scan-rate"><strong>{result.hitRate.toFixed(1)}%</strong><small>{result.hits}/{result.sampleSize} ticks</small></span>
                    </div>
                  ))}
                </div>
              ) : scanCompleted ? (
                <div className="empty-scanner"><strong>No results at {scanThreshold}%+</strong><span>{bestScanResult ? "The highest live frequency is shown above; lower the filter to compare more results." : "Try another contract group or run a fresh scan."}</span></div>
              ) : (
                <div className="empty-scanner"><span className="scan-graphic">⌁</span><strong>Ranked digit results</strong><span>Scan recent ticks to compare Even/Odd, Over/Under, Matches, and Differs across synthetic indices.</span></div>
              )}
              <div className="scanner-disclaimer">Percentages show observed frequency in the selected live sample—not the chance of winning the next trade. Results do not account for payout or guarantee profit. This is a statistical scanner, not a predictive AI model.</div>
            </section>
          </div>

          <section className="panel analysis-panel" id="analysis">
            <div className="panel-heading">
              <div><span className="section-kicker">INSIGHTS</span><h2>Analysis tools</h2></div>
              <span className="muted-badge">Market data from Deriv</span>
            </div>
            <DigitVisualizer symbol={symbol} stats={liveDigitStats} />
            <div className="analysis-content">
              <div className="analysis-icon">⌁</div>
              <div><strong>Live digit analysis</strong><p>The visualizer and scanner reuse this page’s single public Deriv tick stream. Live frequency is descriptive—not a prediction of the next outcome.</p></div>
              <button className="outline-button" type="button" onClick={() => { document.getElementById("scanner")?.scrollIntoView({ behavior: "smooth" }); }}>Open scanner</button>
            </div>

            <section className="manual-trade" aria-labelledby="manual-trade-title">
              <div className="manual-heading">
                <div><span className="section-kicker">TRADE MODE</span><h3 id="manual-trade-title">Manual Trade</h3></div>
                <span className={`bot-status status-${manualView.status}`}>{manualView.status.toUpperCase()}</span>
              </div>
              <p className="panel-description">Start a repeated strategy on the selected Deriv account. It stops at Stop Loss, Take Profit, the trade limit, or the remaining-loss stake cap.</p>
              <DigitVisualizer symbol={symbol} stats={liveDigitStats} />
              <div className="manual-fields">
                <label className="field-wrap"><span className="field-label">Market</span><select className="field" value={symbol} disabled={manualIsActive} onChange={(event) => setSymbol(event.target.value)}>{digitMarkets.map((market) => <option key={market.symbol} value={market.symbol}>{market.display_name} ({market.symbol})</option>)}</select></label>
                <label className="field-wrap"><span className="field-label">Contract</span><select className="field" value={contract} disabled={manualIsActive} onChange={(event) => setContract(event.target.value as DigitContract)}>{DIGIT_CONTRACT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                {contractNeedsBarrier(contract) && <label className="field-wrap"><span className="field-label">Barrier / target digit</span><input className="field" type="number" min={contract === "DIGITOVER" ? 0 : contract === "DIGITUNDER" ? 1 : 0} max={contract === "DIGITOVER" ? 8 : 9} step="1" value={barrier} disabled={manualIsActive} onChange={(event) => setBarrier(event.target.value)} /></label>}
                <label className="field-wrap"><span className="field-label">Stake ({currency || "USD"})</span><input className="field" type="number" min="0.35" max="1000" step="0.01" value={stake} disabled={manualIsActive} onChange={(event) => setStake(event.target.value)} /></label>
                <label className="field-wrap"><span className="field-label">Duration</span><select className="field" value={duration} disabled={manualIsActive} onChange={(event) => setDuration(Number(event.target.value))}>{TICK_DURATIONS.map((ticks) => <option key={ticks} value={ticks}>{ticks} {ticks === 1 ? "Tick" : "Ticks"}</option>)}</select></label>
                <label className="field-wrap"><span className="field-label">Stop Loss ({currency || "USD"})</span><input className="field" type="number" min="0.01" step="0.01" value={manualStopLoss} disabled={manualIsActive} onChange={(event) => setManualStopLoss(event.target.value)} /></label>
                <label className="field-wrap"><span className="field-label">Take Profit ({currency || "USD"})</span><input className="field" type="number" min="0.01" step="0.01" value={manualTakeProfit} disabled={manualIsActive} onChange={(event) => setManualTakeProfit(event.target.value)} /></label>
                <label className="field-wrap"><span className="field-label">Maximum trades (1–100)</span><input className="field" type="number" min="1" max="100" step="1" value={manualMaxTrades} disabled={manualIsActive} onChange={(event) => setManualMaxTrades(event.target.value)} /></label>
                <label className="martingale-toggle"><input type="checkbox" checked={manualMartingale} disabled={manualIsActive} onChange={(event) => setManualMartingale(event.target.checked)} /><span>Martingale</span><small>{manualMartingale ? "On" : "Off"}</small></label>
                {manualMartingale && <label className="field-wrap"><span className="field-label">Martingale multiplier</span><input className="field" type="number" min="1.01" max="5" step="0.1" value={manualMultiplier} disabled={manualIsActive} onChange={(event) => setManualMultiplier(event.target.value)} /></label>}
              </div>
              <div className="manual-summary">
                <span>Trades <strong>{manualView.trades}</strong></span>
                <span>Session P/L <strong className={manualView.profit > 0 ? "profit-positive" : manualView.profit < 0 ? "profit-negative" : ""}>{currency || "—"} {manualView.profit.toFixed(2)}</strong></span>
                <span>Next stake <strong>{currency || "—"} {manualView.stake.toFixed(2)}</strong></span>
              </div>
              {manualIsActive ? (
                <button className="outline-button stop-bot-button" type="button" onClick={() => {
                  const run = manualRunRef.current;
                  if (run) stopManualRun(run, "Stopped by you.");
                }}>Stop strategy</button>
              ) : (
                <button className={`execute-button ${isLive ? "execute-live" : ""}`} type="button" disabled={!activeAccount || manualIsActive || masterIsActive || marketLoading} onClick={() => requestManualStart()}>
                  {isLive ? "Run strategy · confirm real account" : "Run strategy on demo"}
                </button>
              )}
              {manualView.message && <p className={`feedback ${manualView.status === "error" ? "error-text" : ""}`} role="status">{manualView.message}</p>}
              <p className="fine-print">Martingale multiplies exposure and may lose your full available stake. Live runs require confirmation; stop requests take effect after any open contract settles.</p>
            </section>
          </section>

          <section className="panel builder-panel" id="bot-builder">
            <div className="panel-heading">
            <div><span className="section-kicker">STRATEGY WORKSPACE</span><h2>Bot builder</h2></div>
            <span className="muted-badge">Master 5 automation</span>
            </div>
            <p className="panel-description">The general strategy form below saves a preset only. Master 5 has a separate runner and only trades after you start it.</p>
            <div className="builder-fields">
              <label className="field-wrap"><span className="field-label">Strategy name</span><input className="field" value={botName} maxLength={40} onChange={(event) => setBotName(event.target.value)} /></label>
              <label className="field-wrap"><span className="field-label">Market</span><select className="field" value={symbol} onChange={(event) => setSymbol(event.target.value)}>{digitMarkets.map((market) => <option key={market.symbol} value={market.symbol}>{market.symbol}</option>)}</select></label>
              <label className="field-wrap"><span className="field-label">Digit contract</span><select className="field" value={contract} onChange={(event) => setContract(event.target.value as DigitContract)}>{DIGIT_CONTRACT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              {contractNeedsBarrier(contract) && <label className="field-wrap"><span className="field-label">Barrier digit</span><input className="field" type="number" min={contract === "DIGITOVER" ? 0 : contract === "DIGITUNDER" ? 1 : 0} max={contract === "DIGITOVER" ? 8 : 9} step="1" value={barrier} onChange={(event) => setBarrier(event.target.value)} /></label>}
              <label className="field-wrap"><span className="field-label">Stake per trade</span><input className="field" type="number" min="0.35" max="1000" step="0.01" value={botStake} onChange={(event) => setBotStake(event.target.value)} /></label>
              <label className="field-wrap"><span className="field-label">Maximum trades</span><input className="field" type="number" min="1" max="100" step="1" value={maxTrades} onChange={(event) => setMaxTrades(event.target.value)} /></label>
              <label className="field-wrap"><span className="field-label">Stop Loss</span><input className="field" type="number" min="0.01" step="0.01" value={manualStopLoss} onChange={(event) => setManualStopLoss(event.target.value)} /></label>
              <label className="field-wrap"><span className="field-label">Take Profit</span><input className="field" type="number" min="0.01" step="0.01" value={manualTakeProfit} onChange={(event) => setManualTakeProfit(event.target.value)} /></label>
              <label className="field-wrap"><span className="field-label">Tick duration</span><select className="field" value={duration} onChange={(event) => setDuration(Number(event.target.value))}>{TICK_DURATIONS.map((ticks) => <option key={ticks} value={ticks}>{ticks} {ticks === 1 ? "Tick" : "Ticks"}</option>)}</select></label>
              <label className="martingale-toggle"><input type="checkbox" checked={manualMartingale} onChange={(event) => setManualMartingale(event.target.checked)} /><span>Martingale</span><small>{manualMartingale ? "On" : "Off"}</small></label>
              {manualMartingale && <label className="field-wrap"><span className="field-label">Multiplier</span><input className="field" type="number" min="1.01" max="5" step="0.1" value={manualMultiplier} onChange={(event) => setManualMultiplier(event.target.value)} /></label>}
            </div>
            <div className="builder-footer">
              <p className="fine-print">Saving stores a local preset only. To execute a strategy, review it in Manual Trade; real-account runs require confirmation.</p>
              <button className="outline-button gold-outline" type="button" onClick={saveBot}>Save strategy</button>
            </div>
            {botMessage && <p className="feedback" role="status">{botMessage}</p>}

            <section className="master-builder" id="master-5-builder" aria-labelledby="master-5-title">
              <div className="master-heading">
                <div>
                  <span className="section-kicker">AUTOMATED DIGIT STRATEGY</span>
                  <h3 id="master-5-title">Master 5</h3>
                </div>
                <span className={`bot-status status-${masterView.status}`}>{masterView.status.toUpperCase()}</span>
              </div>
              <p className="panel-description">
                Select Even or Odd. Master 5 watches the last price digit, waits for five consecutive opposite-parity ticks, then buys one 1-tick digit contract in your selected parity.
              </p>
              <div className="master-fields">
                <label className="field-wrap">
                  <span className="field-label">Target parity</span>
                  <select className="field" value={masterParity} disabled={masterIsActive} onChange={(event) => setMasterParity(event.target.value as "EVEN" | "ODD")}>
                    <option value="EVEN">Even (DIGITEVEN)</option>
                    <option value="ODD">Odd (DIGITODD)</option>
                  </select>
                </label>
                <label className="field-wrap">
                  <span className="field-label">Deriv market</span>
                  <select className="field" value={symbol} disabled={masterIsActive} onChange={(event) => setSymbol(event.target.value)}>
                    {digitMarkets.map((market) => <option key={market.symbol} value={market.symbol}>{market.symbol}</option>)}
                  </select>
                </label>
                <label className="field-wrap">
                  <span className="field-label">Starting stake ({currency || "account currency"})</span>
                  <input className="field" type="number" min="0.35" max="1000" step="0.01" value={masterStake} disabled={masterIsActive} onChange={(event) => setMasterStake(event.target.value)} />
                </label>
                <label className="field-wrap">
                  <span className="field-label">Take-profit target</span>
                  <input className="field" type="number" min="0.01" step="0.01" value={masterTakeProfit} disabled={masterIsActive} onChange={(event) => setMasterTakeProfit(event.target.value)} />
                </label>
                <label className="field-wrap">
                  <span className="field-label">Stop-loss limit</span>
                  <input className="field" type="number" min="0.01" step="0.01" value={masterStopLoss} disabled={masterIsActive} onChange={(event) => setMasterStopLoss(event.target.value)} />
                </label>
                <label className="field-wrap">
                  <span className="field-label">Trade limit per run</span>
                  <input className="field" type="number" min="1" max="100" step="1" value={masterTradeLimit} disabled={masterIsActive} onChange={(event) => setMasterTradeLimit(event.target.value)} />
                </label>
                <label className="field-wrap">
                  <span className="field-label">Martingale multiplier</span>
                  <input className="field" type="number" min="1.01" max="5" step="0.1" value={masterMultiplier} disabled={masterIsActive} onChange={(event) => setMasterMultiplier(event.target.value)} />
                </label>
              </div>
              <div className="master-risk-note">
                After a loss, the next stake is multiplied by {masterMultiplier || "2"}; after a win, it resets to the starting stake. It stops before an entry if that stake could exceed the remaining stop-loss budget.
              </div>
              <div className="master-run-row">
                <div className="master-stats">
                  <span>Trades <strong>{masterView.trades}</strong></span>
                  <span>Session P/L <strong className={masterView.profit > 0 ? "profit-positive" : masterView.profit < 0 ? "profit-negative" : ""}>{currency || "—"} {masterView.profit.toFixed(2)}</strong></span>
                  <span>Next stake <strong>{currency || "—"} {masterView.stake.toFixed(2)}</strong></span>
                </div>
                <div className="master-controls">
                  {masterIsActive ? (
                    <button className="outline-button stop-bot-button" type="button" onClick={() => {
                      const run = masterRunRef.current;
                      if (run) stopMaster5(run, "Stopped by you.");
                    }}>Stop bot</button>
                  ) : (
                    <button className="execute-button master-start" type="button" disabled={!activeAccount || manualIsActive || !digitMarkets.some((market) => market.symbol === symbol)} onClick={requestMaster5Start}>
                      {masterView.status === "starting" ? "Starting…" : `Start Master 5 · ${isLive ? "LIVE" : "DEMO"}`}
                    </button>
                  )}
                </div>
              </div>
              {masterView.message && <p className={`feedback ${masterView.status === "error" ? "error-text" : ""}`} role="status">{masterView.message}</p>}
              <p className="fine-print">Live mode submits trades automatically after the one-time start confirmation. Martingale increases exposure and can lose money rapidly; stop, trade-count, and stake caps are enforced in this browser session.</p>
            </section>
          </section>

          <section className="free-section" id="free-bots">
            <div className="panel-heading">
              <div><span className="section-kicker">STARTER COLLECTION</span><h2>Free bot templates</h2></div>
              <span className="muted-badge">Free · editable</span>
            </div>
            <p className="panel-description">The first templates load editable settings. Master 5 is an automated digit bot; its risk limits and real/demo mode are selected in the builder before it starts.</p>
            <div className="bot-cards">
              {FREE_BOTS.map((bot, index) => (
                <article className="bot-card" key={bot.name}>
                  <div className={`bot-avatar avatar-${index + 1}`}>{index === 0 ? "↗" : index === 1 ? "↘" : "⌁"}</div>
                  <span className="free-tag">FREE TEMPLATE</span>
                  <h3>{bot.name}</h3>
                  <p>{bot.name === "Master 5" ? `${bot.symbol} · Even after 5 odd digits · Base stake ${bot.stake}` : `${bot.symbol} · ${contractLabel(bot.contract, bot.barrier ?? "")} · Stake ${bot.stake}`}</p>
                  <button className="template-button" type="button" onClick={() => applyBot(bot)}>{bot.name === "Master 5" ? "Configure Master 5" : "Load into builder"} <span>→</span></button>
                </article>
              ))}
            </div>
          </section>

          <footer className="footer">
            <span>BurnitorTrader</span>
            <span>Trading involves risk. You may lose your entire stake.</span>
          </footer>
        </div>
      </div>

      {confirmLive && activeAccount && preparedProposal && (
        <div className="modal-backdrop" role="presentation">
          <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <span className="modal-warning">{isLive ? "LIVE ACCOUNT" : "DEMO ACCOUNT"}</span>
            <h2 id="confirm-title">{isLive ? "Confirm real-money trade" : "Review demo trade"}</h2>
            <p>{isLive ? "Confirming submits this order to your real Deriv account. You could lose the full stake." : "Review the Deriv proposal before submitting this demo order."}</p>
            <div className="confirm-details">
              <span>Account</span><strong>{activeAccount.loginId}</strong>
              <span>Trade</span><strong>{preparedProposal.symbol} · {contractLabel(preparedProposal.contract, preparedProposal.barrier ?? "")} · {preparedProposal.duration} {preparedProposal.duration === 1 ? "tick" : "ticks"}</strong>
              <span>Stake</span><strong>{currency || activeAccount.currency} {preparedProposal.amount.toFixed(2)}</strong>
              <span>Deriv price</span><strong>{currency || activeAccount.currency} {preparedProposal.askPrice.toFixed(2)}</strong>
              {preparedProposal.payout !== undefined && <><span>Potential payout</span><strong>{currency || activeAccount.currency} {preparedProposal.payout.toFixed(2)}</strong></>}
            </div>
            <div className="modal-actions">
              <button className="outline-button" type="button" disabled={tradeBusy} onClick={cancelTradeReview}>Cancel</button>
              <button className={`execute-button ${isLive ? "execute-live" : ""}`} type="button" disabled={tradeBusy} onClick={() => void submitTrade()}>{tradeBusy ? "Sending…" : isLive ? "Confirm live trade" : "Confirm demo trade"}</button>
            </div>
          </section>
        </div>
      )}
      {confirmMasterLive && activeAccount && !masterIsActive && (
        <div className="modal-backdrop" role="presentation">
          <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="master-live-title">
            <span className="modal-warning">LIVE BOT · REAL MONEY</span>
            <h2 id="master-live-title">Start Master 5 on your real account?</h2>
            <p>After you start it, Master 5 will automatically place one-tick digit trades without asking again for each entry. It stops at its profit target, loss limit, trade limit, or stake cap. You can also stop it manually.</p>
            <div className="confirm-details">
              <span>Account</span><strong>{activeAccount.loginId}</strong>
              <span>Rule</span><strong>{masterParity} after five opposite digits</strong>
              <span>Stake / multiplier</span><strong>{currency || activeAccount.currency} {Number(masterStake).toFixed(2)} · {masterMultiplier}×</strong>
              <span>Session limits</span><strong>+{masterTakeProfit} / −{masterStopLoss} · {masterTradeLimit} trades</strong>
            </div>
            <div className="modal-actions">
              <button className="outline-button" type="button" onClick={() => setConfirmMasterLive(false)}>Cancel</button>
              <button className="execute-button execute-live" type="button" onClick={() => {
                setConfirmMasterLive(false);
                void launchMaster5();
              }}>Start live bot</button>
            </div>
          </section>
        </div>
      )}
      {confirmManualLive && activeAccount && pendingManualConfigRef.current && (
        <div className="modal-backdrop" role="presentation">
          <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="manual-live-title">
            <span className="modal-warning">AUTOMATED RUN · REAL MONEY</span>
            <h2 id="manual-live-title">Confirm repeated trades on your real account?</h2>
            <p>This run will buy successive contracts without asking again for each trade. Losses are possible; Martingale can increase stakes. Stop it manually at any time.</p>
            <div className="confirm-details">
              <span>Account</span><strong>{activeAccount.loginId}</strong>
              <span>Strategy</span><strong>{pendingManualConfigRef.current.symbol} · {contractLabel(pendingManualConfigRef.current.contract, pendingManualConfigRef.current.barrier ?? "")}</strong>
              <span>Stake / duration</span><strong>{currency || activeAccount.currency} {pendingManualConfigRef.current.stake.toFixed(2)} · {pendingManualConfigRef.current.duration} ticks</strong>
              <span>Session limits</span><strong>+{pendingManualConfigRef.current.takeProfit} / −{pendingManualConfigRef.current.stopLoss} · {pendingManualConfigRef.current.maxTrades} trades</strong>
              <span>Martingale</span><strong>{pendingManualConfigRef.current.martingaleEnabled ? `${pendingManualConfigRef.current.multiplier}×` : "Off"}</strong>
            </div>
            <div className="modal-actions">
              <button className="outline-button" type="button" onClick={() => {
                setConfirmManualLive(false);
                pendingManualConfigRef.current = null;
              }}>Cancel</button>
              <button className="execute-button execute-live" type="button" onClick={() => {
                const config = pendingManualConfigRef.current;
                if (config) void launchManualRun(config);
              }}>Confirm and start live run</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
