# BurnitorTrader

Deriv-connected trading dashboard built with Next.js.

## Run locally

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local` and set the Deriv app ID and registered redirect URL.
3. Start the development server with `npm run dev`.

The redirect URL must also be registered in the Deriv application settings.

## Dashboard features

- Connect demo and real Deriv accounts through OAuth.
- View account balance and available Deriv markets.
- Review a one-tick digit-contract proposal (Even/Odd, Over/Under, Matches/Differs) before submitting a demo or live order.
- Rank synthetic indices by historical Even/Odd, Over/Under, Matches, and Differs hit frequencies, with 78% or 80% filters and a selectable 100/500/1,000-tick sample.
- Configure and run Master 5: select Even or Odd, wait for five consecutive opposite-parity price digits, then automatically enter a one-tick digit contract.
- Set Master 5 take-profit, stop-loss, trade-count, and martingale multiplier limits. It resets to the starting stake after a winning trade and stops before a doubled stake could exceed the remaining loss budget.
- Save manual strategy configurations in the browser and load free strategy templates.

The scanner reports historical hit frequency, not a forecast or expected return; it does not account for contract payout. No AI model is connected. The general strategy presets and free templates do not trade automatically; Master 5 does place trades after it is started. Live mode requires a separate start confirmation, after which entries are automatic until a limit is reached or the bot is stopped. Martingale increases exposure; trading can lose money, including the full stake.