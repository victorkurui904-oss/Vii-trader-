# BurnitorTrader

Deriv-connected trading dashboard built with Next.js.

## Run locally

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local` and set your Deriv OAuth client ID and redirect URL.
3. Register that exact redirect URL in the Deriv OAuth application settings and enable the `trade` scope. In production, set `DERIV_CLIENT_ID` and `DERIV_REDIRECT_URL` in the deployment environment and redeploy.

The redirect URL must exactly match the URL registered in the Deriv OAuth application settings. The production site uses `https://www.burnitortrader.site`; use `https://www.burnitortrader.site/auth/deriv/callback` consistently rather than the non-`www` domain, which redirects to `www`. The OAuth client ID and redirect URL are read by server routes, and access tokens are stored in an HTTP-only cookie rather than browser storage.

## Dashboard features

- Connect demo and real Deriv accounts through OAuth.
- View account balance and available Deriv synthetic indices, including 1-second volatility indices.
- Review a digit-contract proposal (Even/Odd, Over/Under, Matches/Differs) for 1, 2, 5, or 10 ticks before submitting a demo or live order.
- Visualize recent last-digit frequencies and scan live Volatility and Jump index ticks using one shared public WebSocket feed.
- Run a repeated manual strategy with stop-loss, take-profit, optional Martingale, a tick duration, and a 1–100 trade cap. Real-account runs require a separate confirmation.
- Configure and run Master 5: select Even or Odd, wait for five consecutive opposite-parity price digits, then automatically enter a one-tick digit contract.
- Set Master 5 take-profit, stop-loss, trade-count, and martingale multiplier limits. It resets to the starting stake after a winning trade and stops before a doubled stake could exceed the remaining loss budget.
- Save manual strategy configurations in the browser and load free strategy templates.

The scanner reports frequency from recent live ticks, not a forecast or expected return; it does not account for contract payout. No AI model is connected. General strategy presets and free templates only save settings. Manual Trade and Master 5 can place repeated trades after you start them; real-account runs require confirmation and continue until a configured limit is reached or you stop them. Martingale increases exposure; trading can lose money, including the full stake.