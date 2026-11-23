[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/zxpast/makefun-btc-race-20261123/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/zxpast/makefun-btc-race-20261123/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

Referral code: 6hmpy1rq

# Slow Momentum Rider — BTC race bot

[![make.fun](https://img.shields.io/badge/make.fun-btc--race--24h--20261123--0511-blue)](https://make.fun)
[![entry](https://img.shields.io/badge/entry-main.ts-3178c6)](https://make.fun/c/btc-race-24h-20261123-0511)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)

A long-only trading bot for the [make.fun](https://make.fun) competition
**btc-race-24h-20261123-0511** — race a BTC trading bot live for 24 hours.
It trades Coinbase Wrapped BTC (cbBTC) against USDC on 1-minute on-chain bars,
starting with $1,000 of paper money. No real money is traded.

## Strategy

1-minute noise is wider than the ~26 bps a full-size round trip costs in fee,
slippage and price impact, so the bot only trades a slow, confirmed trend and
otherwise sits in cash:

- **Enter** when the close is 50 bps above where it was 60 bars ago (a real
  1-hour momentum leg), the previous bar already showed positive 60-bar
  momentum (confirmation), the 240-bar return is positive, and the close sits
  above its 240-bar average.
- **Exit** when the position falls 2% below its peak since entry (trailing
  stop), 2% below its cost (hard stop), or the 60-bar return drops under
  -150 bps (the trend has genuinely reversed). No take-profit: winners run
  until the trend breaks.

Full size on entry (one open position at most, long only). Deterministic:
indicators run in float64 on `+ - * /` alone, exits compare bigints exactly,
no clock, no environment, no randomness — two runs on the same bars produce
byte-identical orders.

## Dev-window result (local grade, `--driver process`)

| Net PnL | Return | Trades | Max drawdown | Fees |
| --- | --- | --- | --- | --- |
| +$29.50 | +2.95% | 1 | 1.98% | $0.81 |

Dev gate (net PnL > $0): **passes**. Action log is byte-identical across
repeated runs (sha256 `9064e301baa1d80ffeac5f5bbf825787074eac9ec1d00bbb98c50cdf1b39ff86`).

For comparison on the same dev window: buy-and-hold +$32.17, momentum
+$34.94, ema-cross -$114.83, adx-momentum -$11.20, rsi-bollinger -$9.32.
This bot gives up a little upside on a rising window to lose far less on a
falling one (on the price path mirrored into a downtrend it scores -$17.82
against buy-and-hold's -$41.46).

## Layout

- `main.ts` — the bot (Node 22, erasable TypeScript, stdlib only). Speaks
  `agent-fun/bars-replay/v1`: reads `hello` once, then one `batch` per bar,
  and answers each batch with exactly one reply carrying its `orders`.
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's SDK shim.
- `.makefun/owner.json` — wallet claim for the entry.
- `LICENSE` — MIT.

## Grade locally

```sh
node cli/makefun.mjs grade-local --kit <kit-dir> --bot . --driver process
```

(Docker is not available on this machine, so the process driver is used.)
