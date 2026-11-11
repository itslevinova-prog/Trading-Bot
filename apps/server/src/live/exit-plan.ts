import { resolveNativeBracket } from './bracket-lineage.js';
import { createHash } from 'node:crypto';
import type { Action, OrderBook } from '@paper/shared';
import { partialBook, type BinanceSymbol } from '../market/binance-data.js';
import type { AccountSnapshot, LiveLimits } from './BinanceSpotExecutionAdapter.js';
import { entryContract, assertNativeList, assertNativeOrder } from './native-contract.js';
import { ownedNativeOrder, stopCoverage, type NativeOrder } from './protection.js';
import type { Journal } from './journal.js';
import { checkedBalances, nativeQuantityAllowed, nativeQuantityStep, belowNativeQuantity, limitQuantityAllowed, limitNotionalAllowed, nativeNotionalAllowed } from './balances.js';
import { addDecimal, subtractDecimal, compareDecimal, floorStep, multiplyToStep, numberDecimal, basisPointFraction } from './decimal.js';
type SellAction = Extract<Action, {
    type: 'sell';
}>;
export type NativeExitPlan = {
    kind: 'opoco-exit-plan-v1';
    id: string;
    pair: string;
    decisionId: string;
    actionHash: string;
    preparedAt: number;
    accountAsOf: number;
    bookAsOf: number;
    ordersAsOf: number;
    parentReceiptsAsOf: number;
    parentId: string;
    parentKind?: 'opoco' | 'oco';
    parentClientOrderId?: string;
    rootEntryId?: string;
    ancestryDepth?: number;
    ancestorOrderIds?: number[];
    ancestorListIds?: number[];
    parentListId: number;
    entryOrderId: number;
    stopOrderId: number;
    targetOrderId: number;
    observedPositionQty: string;
    observedProtectedQty: string;
    observedEntryQty: string;
    observedEntryPrice: string;
    purpose?: 'reduce' | 'tighten';
    reprotectStopPrice?: string;
    requestedFraction: string;
    limitSell: {
        symbol: string;
        side: 'SELL';
        type: 'LIMIT';
        timeInForce: 'FOK';
        quantity: string;
        price: string;
        newClientOrderId: string;
        newOrderRespType: 'FULL';
    };
    cancel: {
        symbol: string;
        orderListId: string;
        listClientOrderId: string;
        newClientOrderId: string;
    };
    oldStopPrice: string;
    oldTargetPrice: string;
    predictedRemainingQty: string;
    estimatedNetProtectionQty: string;
    requiresPostCancelRecheck: true;
    requiresPostFillRecheck: true;
    mutationAuthorized: false;
    feeScheduleVerified: false;
    scope: string;
};
const fresh = (at: number, now: number, age: number) => Number.isSafeInteger(at) && at >= 0 && at <= now && now - at <= age;
/** Pure owned OPOCO/OCO exit preflight. No network or journal mutation; a plan alone authorizes no order. */
export function prepareOpocoExit(input: {
    action: SellAction;
    decisionId: string;
    account: AccountSnapshot;
    symbols: BinanceSymbol[];
    openOrders: NativeOrder[];
    parentList: unknown;
    parentOrders: unknown[];
    ordersAsOf: number;
    parentReceiptsAsOf: number;
    book: OrderBook;
    journal: Journal;
    limits: Pick<LiveLimits, 'quote' | 'feeReservePct' | 'maxSpreadBps' | 'maxSlippageBps'>;
    now: number;
}): NativeExitPlan {
    const { action, account, symbols, openOrders, journal, limits, now } = input;
    if (action.type !== 'sell' || !Number.isFinite(action.sellFraction) || action.sellFraction <= 0 || action.sellFraction > 1 || typeof input.decisionId !== 'string' || !input.decisionId || input.decisionId.length > 200 || !Number.isSafeInteger(now) || now < 0)
        throw Error('Invalid native exit action');
    if (!Number.isFinite(limits.feeReservePct) || limits.feeReservePct < .001 || limits.feeReservePct > .05 || !Number.isFinite(limits.maxSpreadBps) || limits.maxSpreadBps < 1 || limits.maxSpreadBps > 100 || !Number.isFinite(limits.maxSlippageBps) || limits.maxSlippageBps < 1 || limits.maxSlippageBps > 100)
        throw Error('Invalid native exit limits');
    if (journal.unresolved().length)
        throw Error('Unresolved native intent blocks exit planning');
    const halt = journal.getMeta('halt');
    if (halt && halt !== 'Drawdown limit')
        throw Error('Native journal halt requires reconciliation');
    if (!fresh(account.asOf, now, 15000) || !fresh(account.snapshotCompletedAt, now, 15000) || account.snapshotCompletedAt < account.asOf || !Number.isFinite(account.equity) || account.equity <= 0)
        throw Error('Native exit account snapshot stale or invalid');
    const balances = checkedBalances(account), symbol = symbols.find(s => `${s.baseAsset}/${s.quoteAsset}` === action.pair);
    if (!symbol || symbol.status !== 'TRADING' || symbol.quoteAsset !== limits.quote || symbol.isSpotTradingAllowed === false || !symbol.ocoAllowed || !['LIMIT', 'STOP_LOSS', 'TAKE_PROFIT'].every(t => symbol.orderTypes.includes(t)))
        throw Error('Native exit symbol/reprotection capability unavailable');
    if (!fresh(input.ordersAsOf, now, 5000) || !fresh(input.parentReceiptsAsOf, now, 5000))
        throw Error('Native exit order receipts stale or future');
    if (!Array.isArray(openOrders) || openOrders.some(o => !ownedNativeOrder(o, journal, now) || o.side === 'BUY'))
        throw Error('Foreign or still-working native order');
    const positive = balances.filter(b => b.asset !== limits.quote && compareDecimal(addDecimal(b.free, b.locked), '0') > 0);
    if (positive.length !== account.positions.length || new Set(account.positions.map(p => p.pair)).size !== account.positions.length)
        throw Error('Native exit holdings incomplete or duplicated');
    for (const p of account.positions) {
        const meta = symbols.find(s => `${s.baseAsset}/${s.quoteAsset}` === p.pair), balance = meta ? positive.find(b => b.asset === meta.baseAsset) : undefined;
        if (!meta || !balance || !fresh(p.priceAsOf, now, 5000) || p.priceAsOf < account.asOf || p.priceAsOf > account.snapshotCompletedAt || p.value !== p.qty * p.bid || !Number.isFinite(p.bid) || p.bid <= 0 || p.qty !== Number(p.qtyText) || compareDecimal(p.qtyText, addDecimal(balance.free, balance.locked)) !== 0)
            throw Error('Native exit holding snapshot mismatch');
        const coverage = stopCoverage(p, openOrders, journal, now);
        if (!coverage.valid || compareDecimal(coverage.quantityText, p.qtyText) > 0)
            throw Error('Native exit invalid protection');
        const residual = subtractDecimal(p.qtyText, coverage.quantityText);
        if (compareDecimal(residual, '0') > 0 && !belowNativeQuantity(residual, meta))
            throw Error('Native exit unprotected holding');
    }
    const quote = balances.find(b => b.asset === limits.quote), equity = (quote ? Number(addDecimal(quote.free, quote.locked)) : 0) + account.positions.reduce((sum, p) => sum + p.value, 0);
    if (account.cash !== (quote ? Number(quote.free) : 0) || !Number.isFinite(equity) || Math.abs(equity - account.equity) > Math.max(1e-8, equity * 1e-12))
        throw Error('Native exit equity/cash snapshot mismatch');
    const p = account.positions.find(p => p.pair === action.pair);
    if (!p)
        throw Error('No owned native position to reduce');
    if (!input.book.valid || input.book.symbol !== action.pair || !fresh(input.book.receivedAt, now, 2000))
        throw Error('Native exit book stale, foreign or future');
    const book = partialBook(action.pair, { bids: input.book.bids.map(x => [x.price, x.qty]), asks: input.book.asks.map(x => [x.price, x.qty]) }, input.book.receivedAt);
    if (!book.valid)
        throw Error('Invalid native exit order book');
    const bid = Number(book.bids[0]!.price), ask = Number(book.asks[0]!.price);
    if ((ask / bid - 1) * 10000 > limits.maxSpreadBps)
        throw Error('Native exit spread too large');
    const same = openOrders.filter(o => o.symbol === symbol.symbol), stop = same.find(o => o.type === 'STOP_LOSS'), target = same.find(o => o.type === 'TAKE_PROFIT');
    if (same.length !== 2 || !stop || !target || stop.status !== 'NEW' || target.status !== 'NEW' || stop.clientOrderId.slice(0, -2) !== target.clientOrderId.slice(0, -2))
        throw Error('Native exit requires one inactive-trigger owned native bracket');
    const parentId = stop.clientOrderId.slice(0, -2), parent = journal.get(parentId);
    if (!parent || !(parent.side === 'buy' && parent.state === 'accepted' || parent.side === 'sell' && parent.state === 'exit_protected'))
        throw Error('Native exit parent provenance missing');
    const lineage = parent.side === 'sell' ? resolveNativeBracket(parent.id, journal, now) : null, contract = lineage?.contract ?? entryContract(parent), list = assertNativeList(input.parentList, contract);
    if (lineage && list.orderListId !== lineage.list.orderListId)
        throw Error('Native replacement list numeric identity changed');
    if (!Array.isArray(input.parentOrders) || input.parentOrders.length !== contract.children.length)
        throw Error('Native exit child receipts incomplete');
    const reports = contract.children.map(c => {
        const matches = input.parentOrders.filter(x => x && typeof x === 'object' && (x as {
            clientOrderId?: unknown;
        }).clientOrderId === c.clientOrderId);
        if (matches.length !== 1)
            throw Error('Native exit duplicate or missing child report');
        return assertNativeOrder(matches[0], list, c);
    }), stopReport = reports[reports.length - 2]!, targetReport = reports[reports.length - 1]!, entryQuantity = lineage?.entryQuantity ?? contract.children[0]!.quantity!, entryPrice = lineage?.entryPrice ?? contract.children[0]!.price!;
    if (!lineage && reports[0]!.status !== 'FILLED' || stopReport.status !== 'NEW' || targetReport.status !== 'NEW' || compareDecimal(stopReport.originalQty!, targetReport.originalQty!) !== 0 || compareDecimal(stopReport.originalQty!, stop.origQty!) !== 0 || compareDecimal(targetReport.originalQty!, target.origQty!) !== 0 || compareDecimal(p.qtyText, entryQuantity) > 0 || lineage && compareDecimal(p.qtyText, lineage.remainingQty!) !== 0)
        throw Error('Native exit entry/protection quantities disagree');
    assertNativeOrder(stop, list, contract.children[contract.children.length - 2]!);
    assertNativeOrder(target, list, contract.children[contract.children.length - 1]!);
    const oldStopPrice = contract.children[contract.children.length - 2]!.stopPrice!, oldTargetPrice = contract.children[contract.children.length - 1]!.stopPrice!;
    if (compareDecimal(oldStopPrice, book.bids[0]!.price) >= 0 || compareDecimal(oldTargetPrice, book.asks[0]!.price) <= 0)
        throw Error('Native trigger already reached; reconcile before cancel');
    const lot = symbol.filters.find(f => f.filterType === 'LOT_SIZE'), priceFilter = symbol.filters.find(f => f.filterType === 'PRICE_FILTER');
    if (!lot?.stepSize || !priceFilter?.tickSize)
        throw Error('Native exit filters missing');
    const requestedFraction = numberDecimal(action.sellFraction), quantity = multiplyToStep(p.qtyText, requestedFraction, lot.stepSize), price = multiplyToStep(book.bids[0]!.price, subtractDecimal('1', basisPointFraction(limits.maxSlippageBps)), priceFilter.tickSize, true);
    if (!limitQuantityAllowed(quantity, symbol) || !limitNotionalAllowed(Number(quantity), Number(price), symbol) || compareDecimal(quantity, p.qtyText) > 0)
        throw Error('Native exit quantity/notional invalid');
    for (const candidate of [price, oldStopPrice, oldTargetPrice]) {
        if (compareDecimal(candidate, floorStep(candidate, priceFilter.tickSize)) !== 0 || priceFilter.minPrice && compareDecimal(priceFilter.minPrice, '0') > 0 && compareDecimal(candidate, priceFilter.minPrice) < 0 || priceFilter.maxPrice && compareDecimal(priceFilter.maxPrice, '0') > 0 && compareDecimal(candidate, priceFilter.maxPrice) > 0)
            throw Error('Native exit/protection price filter mismatch');
    }
    let depth = '0';
    for (const level of book.bids) {
        if (compareDecimal(level.price, price) < 0)
            break;
        depth = addDecimal(depth, level.qty);
    }
    if (compareDecimal(depth, quantity) < 0)
        throw Error('Insufficient observed limit-exit depth');
    const remaining = subtractDecimal(p.qtyText, quantity), quantum = nativeQuantityStep(symbol), estimated = multiplyToStep(remaining, subtractDecimal('1', numberDecimal(limits.feeReservePct)), quantum);
    if (compareDecimal(remaining, '0') > 0 && !belowNativeQuantity(remaining, symbol) && (!nativeQuantityAllowed(estimated, symbol) || !nativeNotionalAllowed(Number(estimated), Number(oldStopPrice), symbol) || !nativeNotionalAllowed(Number(estimated), Number(oldTargetPrice), symbol)))
        throw Error('Native exit would leave an unprotectable estimated remainder');
    const actionHash = createHash('sha256').update(JSON.stringify({ decisionId: input.decisionId, pair: action.pair, sellFraction: requestedFraction })).digest('hex'), id = 'bot_' + createHash('sha256').update(`${input.decisionId}:${action.pair}:sell`).digest('hex').slice(0, 24);
    return { kind: 'opoco-exit-plan-v1', id, pair: action.pair, decisionId: input.decisionId, actionHash, preparedAt: now, accountAsOf: account.asOf, bookAsOf: book.receivedAt, ordersAsOf: input.ordersAsOf, parentReceiptsAsOf: input.parentReceiptsAsOf, parentId, parentKind: lineage ? 'oco' : 'opoco', parentClientOrderId: contract.listClientOrderId, rootEntryId: lineage?.root.id ?? parentId, ancestryDepth: lineage?.depth ?? 0, ancestorOrderIds: lineage?.orderIds ?? reports.map(r => r.orderId).sort((a, b) => a - b), ancestorListIds: lineage?.listIds ?? [list.orderListId], parentListId: list.orderListId, entryOrderId: lineage?.entryOrderId ?? reports[0]!.orderId, stopOrderId: stopReport.orderId, targetOrderId: targetReport.orderId, observedPositionQty: p.qtyText, observedProtectedQty: stopReport.originalQty!, observedEntryQty: entryQuantity, observedEntryPrice: entryPrice, requestedFraction, limitSell: { symbol: symbol.symbol, side: 'SELL', type: 'LIMIT', timeInForce: 'FOK', quantity, price, newClientOrderId: id + '_x', newOrderRespType: 'FULL' }, cancel: { symbol: symbol.symbol, orderListId: String(list.orderListId), listClientOrderId: contract.listClientOrderId, newClientOrderId: id + '_c' }, oldStopPrice, oldTargetPrice, predictedRemainingQty: remaining, estimatedNetProtectionQty: estimated, requiresPostCancelRecheck: true, requiresPostFillRecheck: true, mutationAuthorized: false, feeScheduleVerified: false, scope: 'Pure owned OPOCO/OCO exit preflight with root lineage; separately enabled effect/recovery transport required. Rest protection amount is an estimate until post-fill balances and commissions are reconciled.' };
}
/** Reuse full ownership preflight; replacement never requests a model sale or lowers a stop. */
export function prepareOpocoStopTightening(input: Parameters<typeof prepareOpocoExit>[0], stopPrice: string): NativeExitPlan {
    const plan = prepareOpocoExit({ ...input, action: { ...input.action, sellFraction: 1 } }), symbol = input.symbols.find(s => s.symbol === plan.limitSell.symbol)!, tick = symbol.filters.find(f => f.filterType === 'PRICE_FILTER')!.tickSize!;
    if (compareDecimal(stopPrice, plan.oldStopPrice) < 0 || compareDecimal(stopPrice, input.book.bids[0]!.price) >= 0 || compareDecimal(stopPrice, floorStep(stopPrice, tick)) !== 0)
        throw Error('Native stop replacement must be tick-aligned, below bid and never lower');
    const id = 'bot_' + createHash('sha256').update(`${input.decisionId}:${plan.pair}:protect:${stopPrice}`).digest('hex').slice(0, 24), actionHash = createHash('sha256').update(JSON.stringify({ decisionId: input.decisionId, pair: plan.pair, stopPrice, purpose: 'tighten' })).digest('hex');
    return { ...plan, id, actionHash, purpose: 'tighten', reprotectStopPrice: stopPrice, requestedFraction: '0', predictedRemainingQty: plan.observedPositionQty, limitSell: { ...plan.limitSell, quantity: '0', newClientOrderId: id + '_x' }, cancel: { ...plan.cancel, newClientOrderId: id + '_c' }, scope: 'Pure owned OPOCO/OCO stop tightening; no model sale and no mutation authorization.' };
}
