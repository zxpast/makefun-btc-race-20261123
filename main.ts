// Slow Momentum Rider — a long-only trend bot for the make.fun BTC race.
//
// It trades one symbol (CBBTC) on 1-minute bars, speaking agent-fun/bars-replay/v1
// through the kit SDK shim in vendor/. The harness sends hello once, then one batch
// per bar; the bot answers every batch with exactly one reply carrying its orders
// (here at most one buy or one sell, far under the 16-order cap). Each order fills
// at the next bar's open, so every signal is judged on the close of its own bar.
//
// Idea: 1-minute noise is wider than the ~26 bps a full-size round trip costs in
// fee, slippage and price impact, so this bot only trades a slow, confirmed trend
// and otherwise sits in cash:
//   - entry: the close is 50 bps above where it was 60 bars ago (a real 1-hour
//     momentum leg, not a 1-minute wiggle), the previous bar already showed
//     positive 60-bar momentum (confirmation, so a one-bar spike cannot enter),
//     the 240-bar return is positive and the close sits above its 240-bar average
//     (the long trend points up, not down).
//   - exit: the position falls 2% below its peak since entry (trailing stop), or
//     2% below its cost (hard stop), or the 60-bar return drops under -150 bps
//     (the trend has genuinely reversed, not merely paused).
// No take-profit: a winner runs until the trend breaks. Full size on entry (one
// open position at most, long only, $1,000 paper USDC, never real money).
//
// Everything is deterministic: the indicators run in float64 on + - * / alone, the
// exits compare bigints exactly, and the bot reads no clock, no environment and no
// randomness (hello.seed is ignored because the bot needs none). Two runs on the
// same bars therefore produce byte-identical orders.

import { runBars, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

// --- tunables: picked on the dev window, kept on the plateau, not the spike ---
const LOOK_BARS = 60; // momentum lookback, in bars (one hour)
const ENTRY_RET_BPS = 50; // enter when the 60-bar return tops +50 bps
const EXIT_RET_BPS = -150; // exit when the 60-bar return drops under -150 bps
const TREND_BARS = 240; // long-trend window, in bars (four hours)
const TRAIL_BPS = 200; // trailing stop: 2% under the peak since entry
const STOP_BPS = 200; // hard stop: 2% under the entry cost
const MAX_SLIPPAGE_BPS = 100; // 1% past the close the order was decided on

/** One symbol's closes, the previous bar's 60-bar return, and its peak value. */
interface Series {
  closes: number[];
  prevRet: number | null;
  peak: bigint;
}

const series = new Map<string, Series>();

function getSeries(symbol: string): Series {
  let s = series.get(symbol);
  if (s === undefined) {
    s = { closes: [], prevRet: null, peak: 0n };
    series.set(symbol, s);
  }
  return s;
}

/** The return in bps of `close` against the close `bars` back, or null. */
function retBps(s: Series, close: number, bars: number): number | null {
  if (s.closes.length <= bars) return null;
  const ago = s.closes[s.closes.length - 1 - bars]!;
  return ((close / ago) - 1) * 10000;
}

/** The mean of the last `bars` closes, or null before that many bars. */
function meanClose(s: Series, bars: number): number | null {
  if (s.closes.length < bars) return null;
  let sum = 0;
  for (let i = s.closes.length - bars; i < s.closes.length; i++) sum += s.closes[i]!;
  return sum / bars;
}

await runBars({
  onBatch(state: BarsState, batch) {
    // Fold this batch's bars into the indicators, one bar per symbol.
    const fresh = new Set<string>();
    const ret60 = new Map<string, number>();
    for (const bar of batch.bars) {
      const s = getSeries(bar.symbol);
      s.closes.push(Number(bar.c));
      fresh.add(bar.symbol);
      const r = retBps(s, Number(bar.c), LOOK_BARS);
      if (r !== null) ret60.set(bar.symbol, r);
    }
    // Warm-up batches carry bars before the scored window: read them, send nothing.
    if (state.warmingUp) return [];

    const { caps, fees } = state.hello;
    const orders: (BuyInput | SellInput)[] = [];

    for (const { symbol } of state.hello.symbols) {
      if (!fresh.has(symbol)) continue; // a symbol with no bar this batch: no decision
      const s = series.get(symbol)!;
      const close = Number(state.close(symbol)!);
      const r60 = ret60.get(symbol);
      const held = state.positions.get(symbol);

      if (held !== undefined) {
        // Holding: track the peak value at each close, then test the exits.
        const value = state.value(symbol, held.qty);
        if (value > s.peak) s.peak = value;
        const trailing = (value * 10000n <= s.peak * BigInt(10000 - TRAIL_BPS));
        const stopped = (value * 10000n <= held.cost * BigInt(10000 - STOP_BPS));
        const reversed = (r60 !== undefined && r60 < EXIT_RET_BPS);
        if (trailing || stopped || reversed) {
          orders.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
          s.peak = 0n;
        }
        continue;
      }

      // Flat: enter only on a confirmed, trend-backed momentum leg.
      s.peak = 0n;
      if (r60 === undefined || r60 <= ENTRY_RET_BPS) continue;
      if (s.prevRet === null || s.prevRet <= 0) continue; // confirmation: the bar before already showed positive momentum
      const r240 = retBps(s, close, TREND_BARS);
      if (r240 !== null && r240 <= 0) continue; // the 4-hour trend must point up, not down
      const sma = meanClose(s, TREND_BARS);
      if (sma !== null && close <= sma) continue; // close must sit above its average
      if (state.cash < BigInt(fees.min_notional_quote_units)) continue;
      let size = state.cash;
      const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / 10000n;
      if (size > byWeight) size = byWeight;
      if (size < BigInt(fees.min_notional_quote_units)) continue;
      orders.push({ side: 'buy', symbol, notional_quote_units: size, max_slippage_bps: MAX_SLIPPAGE_BPS });
    }

    // Remember this batch's 60-bar returns for the next batch's confirmation.
    for (const [symbol, r] of ret60) series.get(symbol)!.prevRet = r;
    return orders.slice(0, caps.max_orders_per_bar);
  },
});
