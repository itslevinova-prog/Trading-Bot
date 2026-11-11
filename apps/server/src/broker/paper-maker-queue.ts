/** Paper-only reference queue. It never sends orders or mutates the account ledger.
 * A separate broker integration must validate risk and commit any simulated fill. */
export type MakerSide = 'buy' | 'sell';
export type MakerRequest = {
  id: string; symbol: string; side: MakerSide;
  qty: number; bestBid: number; bestAsk: number;
  placedAt: number; ttlMs: number; makerFeeRate: number;
};
export type MakerPending = {
  id: string; symbol: string; side: MakerSide; qty: number;
  limitPrice: number; placedAt: number; expiresAt: number; makerFeeRate: number;
};
export type MakerFill = {
  id: string; symbol: string; side: MakerSide; qty: number;
  price: number; fee: number; observedAt: number;
};
const validPrice = (n: number) => Number.isFinite(n) && n > 0;
const validTime = (n: number) => Number.isSafeInteger(n) && n >= 0;
export class PaperMakerQueue {
  readonly pending = new Map<string, MakerPending>();
  readonly fills: MakerFill[] = [];
  readonly missed: MakerPending[] = [];
  private readonly finished = new Set<string>();
  private readonly latestTradeAt = new Map<string, number>();

  place(req: MakerRequest): MakerPending {
    if (!req.id || !req.symbol || !['buy', 'sell'].includes(req.side) ||
      !validPrice(req.qty) || !validPrice(req.bestBid) || !validPrice(req.bestAsk) ||
      req.bestBid >= req.bestAsk || !validTime(req.placedAt) ||
      !Number.isSafeInteger(req.ttlMs) || req.ttlMs < 1 ||
      !validTime(req.placedAt + req.ttlMs) ||
      !Number.isFinite(req.makerFeeRate) || req.makerFeeRate < 0 || req.makerFeeRate > 0.05)
      throw Error('Invalid post-only maker request');
    if (this.pending.has(req.id) || this.finished.has(req.id))
      throw Error('Duplicate maker order id');
    const limitPrice = req.side === 'buy' ? req.bestBid : req.bestAsk;
    const order: MakerPending = {id: req.id, symbol: req.symbol, side: req.side,
      qty: req.qty, limitPrice, placedAt: req.placedAt,
      expiresAt: req.placedAt + req.ttlMs, makerFeeRate: req.makerFeeRate};
    this.pending.set(req.id, order);
    return order;
  }
  /** A touch never fills. Require a later public trade strictly THROUGH the limit
   * with at least the requested size. These are deliberately conservative,
   * still hypothetical and not a real exchange queue-position reconstruction. */
  observeTrade(trade: {symbol: string; price: number; qty: number; ts: number}): MakerFill[] {
    if (!validPrice(trade.price) || !validPrice(trade.qty) || !validTime(trade.ts))
      throw Error('Invalid public trade');
    const latest = this.latestTradeAt.get(trade.symbol);
    if (latest !== undefined && trade.ts <= latest)
      throw Error('Non-monotonic or duplicate public trade time');
    this.latestTradeAt.set(trade.symbol, trade.ts);
    const made: MakerFill[] = [];
    let remaining = trade.qty;
    // One public trade cannot fill more simulated quantity than it actually reports.
    const queue = [...this.pending.values()]
      .filter(order => order.symbol === trade.symbol)
      .sort((a, b) => a.placedAt - b.placedAt || a.id.localeCompare(b.id));
    for (const order of queue) {
      if (trade.ts <= order.placedAt || trade.ts > order.expiresAt ||
        remaining < order.qty) continue;
      const through = order.side === 'buy' ?
        trade.price < order.limitPrice : trade.price > order.limitPrice;
      if (!through) continue;
      const fill: MakerFill = {id: order.id, symbol: order.symbol, side: order.side,
        qty: order.qty, price: order.limitPrice, fee: order.qty * order.limitPrice * order.makerFeeRate,
        observedAt: trade.ts};
      remaining -= order.qty;
      this.pending.delete(order.id);
      this.finished.add(order.id);
      this.fills.push(fill);
      made.push(fill);
    }
    return made;
  }
  expire(now: number): MakerPending[] {
    if (!validTime(now)) throw Error('Invalid expiry clock');
    const expired: MakerPending[] = [];
    for (const order of this.pending.values()) {
      if (now <= order.expiresAt) continue;
      this.pending.delete(order.id);
      this.finished.add(order.id);
      this.missed.push(order);
      expired.push(order);
    }
    return expired;
  }
}
