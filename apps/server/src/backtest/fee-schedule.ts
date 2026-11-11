/**
 * Versioned OFFLINE fee assumptions. The rates are not a claim about historical
 * exchange tiers, account discounts or an actual maker queue position.
 */
export type FeeLiquidity = 'maker' | 'taker';
export type FeeTariff = Readonly<{
  id: string;
  quote: 'EUR' | 'USDT' | 'USDC';
  fromMs: number;
  untilMs: number;
  makerRate: number;
  takerRate: number;
  source: 'synthetic-assumption' | 'public-assumption';
}>;
export type FeeSelection = Readonly<{
  tariffId: string;
  liquidity: FeeLiquidity;
  rate: number;
  rounding: 'round-up-quote-8dp';
  source: FeeTariff['source'];
}>;
export type FeeCharge = FeeSelection & { fee: number };

const validRate = (n: number) => Number.isFinite(n) && n >= 0 && n < 1;
const validTime = (n: number) => Number.isSafeInteger(n) && n >= 0;
const allowedQuotes = new Set(['EUR', 'USDT', 'USDC']);

/** Fails closed for absent periods or overlapping assumptions. */
export class FeeSchedule {
  readonly tariffs: readonly FeeTariff[];
  readonly stressMultiplier: number;

  constructor(tariffs: readonly FeeTariff[], stressMultiplier = 1) {
    if (!Number.isFinite(stressMultiplier) || stressMultiplier < 1 || stressMultiplier > 100)
      throw Error('Invalid fee stress multiplier');
    const ids = new Set<string>();
    for (const tariff of tariffs) {
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(tariff.id) || ids.has(tariff.id) ||
        !allowedQuotes.has(tariff.quote) || !validTime(tariff.fromMs) ||
        !validTime(tariff.untilMs) || tariff.untilMs <= tariff.fromMs ||
        !validRate(tariff.makerRate) || !validRate(tariff.takerRate) ||
        !['synthetic-assumption', 'public-assumption'].includes(tariff.source))
        throw Error('Invalid or duplicate fee assumption');
      ids.add(tariff.id);
    }
    for (const [i, tariff] of tariffs.entries())
      if (tariffs.slice(i + 1).some(other =>
        other.quote === tariff.quote &&
        tariff.fromMs < other.untilMs && other.fromMs < tariff.untilMs))
        throw Error('Overlapping fee assumptions for quote ' + tariff.quote);
    this.tariffs = Object.freeze(tariffs.map(t => Object.freeze({...t})));
    this.stressMultiplier = stressMultiplier;
    Object.freeze(this);
  }

  withStress(multiplier: number): FeeSchedule {
    return new FeeSchedule(this.tariffs, multiplier);
  }

  select(symbol: string, atMs: number, liquidity: FeeLiquidity): FeeSelection {
    if (!validTime(atMs) || !['maker', 'taker'].includes(liquidity))
      throw Error('Invalid fee lookup');
    const quote = symbol.split('/')[1];
    if (!quote || !allowedQuotes.has(quote) || !/^[A-Z0-9]{2,20}[/](EUR|USDT|USDC)$/.test(symbol))
      throw Error('Unknown quote currency for fee assumptions');
    const tariff = this.tariffs.find(t => t.quote === quote && atMs >= t.fromMs && atMs < t.untilMs);
    if (!tariff) throw Error('Unknown fee assumption at fill time: ' + symbol);
    const rate = (liquidity === 'maker' ? tariff.makerRate : tariff.takerRate) * this.stressMultiplier;
    if (!validRate(rate)) throw Error('Stressed fee rate out of range');
    return Object.freeze({
      tariffId: tariff.id, liquidity, rate, rounding: 'round-up-quote-8dp' as const,
      source: tariff.source
    });
  }

  charge(symbol: string, atMs: number, liquidity: FeeLiquidity, notional: number): FeeCharge {
    if (!Number.isFinite(notional) || notional < 0 || notional > 1e12)
      throw Error('Invalid notional for fee');
    const selected = this.select(symbol, atMs, liquidity);
    // Always round against the simulated account; no unrecorded discount.
    const fee = Math.ceil(notional * selected.rate * 1e8) / 1e8;
    if (!Number.isFinite(fee)) throw Error('Invalid rounded fee');
    return {...selected, fee};
  }
}
