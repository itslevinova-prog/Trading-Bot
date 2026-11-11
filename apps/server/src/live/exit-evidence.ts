import type { NativeExitPlan } from './exit-plan.js';
import type { BinanceSymbol } from '../market/binance-data.js';
import type { ListContract, ListIdentity, ChildContract } from './native-contract.js';
import { assertNativeList, assertNativeOrder } from './native-contract.js';
import { checkedBalances } from './balances.js';
import { addDecimal, subtractDecimal, compareDecimal, floorStep } from './decimal.js';
export type RawOrder = Record<string, unknown>;
export type ExitObservation = {
    asOf: number;
    completedAt: number;
    account: {
        canTrade: unknown;
        balances: unknown;
    };
    openOrders: RawOrder[];
    parentList: unknown;
    parentOrders: RawOrder[];
    trades: Record<string, unknown[]>;
    book: {
        symbol: string;
        valid: boolean;
        receivedAt: number;
        bids: {
            price: string;
            qty: string;
        }[];
        asks: {
            price: string;
            qty: string;
        }[];
    };
    lastTradePrice: string;
    lastTradeAsOf: number;
    symbol: BinanceSymbol;
    symbolAsOf: number;
    sellOrder?: RawOrder | null;
    protectionList?: unknown;
    protectionOrders?: RawOrder[];
};
export type ExitSellCommand = {
    symbol: string;
    side: 'SELL';
    type: 'LIMIT';
    timeInForce: 'FOK';
    quantity: string;
    price: string;
    newClientOrderId: string;
    newOrderRespType: 'FULL';
};
export type ExitProtectCommand = {
    symbol: string;
    side: 'SELL';
    quantity: string;
    listClientOrderId: string;
    aboveType: 'TAKE_PROFIT';
    aboveStopPrice: string;
    aboveClientOrderId: string;
    belowType: 'STOP_LOSS';
    belowStopPrice: string;
    belowClientOrderId: string;
    newOrderRespType: 'FULL';
};
const obj = (v: unknown): v is RawOrder => !!v && typeof v === 'object' && !Array.isArray(v);
export function exitDecimal(v: unknown, positive = false): string {
    if (typeof v !== 'string' || !Number.isFinite(Number(v)) || compareDecimal(v, '0') < (positive ? 1 : 0))
        throw Error('Invalid exit decimal evidence');
    return v;
}
export function assertExitFresh(o: ExitObservation, now: number, book = false) {
    if (!Number.isSafeInteger(now) || now < 0 || ![o.asOf, o.completedAt].every(t => Number.isSafeInteger(t) && t >= 0 && t <= now) || o.completedAt < o.asOf || now - o.asOf > 5000 || !Array.isArray(o.openOrders) || !Array.isArray(o.parentOrders) || !Number.isSafeInteger(o.symbolAsOf) || o.symbolAsOf < o.asOf || o.symbolAsOf > o.completedAt)
        throw Error('Native exit observation stale/invalid');
    checkedBalances(o.account);
    if (book && (!o.book.valid || !Number.isSafeInteger(o.book.receivedAt) || o.book.receivedAt < o.asOf || o.book.receivedAt > o.completedAt || now - o.book.receivedAt > 2000 || !Number.isSafeInteger(o.lastTradeAsOf) || o.lastTradeAsOf < o.asOf || o.lastTradeAsOf > o.completedAt || now - o.lastTradeAsOf > 2000))
        throw Error('Native exit book/ticker stale/invalid');
}
export function exitBaseBalance(o: ExitObservation, symbol: BinanceSymbol) { const b = checkedBalances(o.account).find(b => b.asset === symbol.baseAsset); return { free: b?.free ?? '0', locked: b?.locked ?? '0', total: addDecimal(b?.free ?? '0', b?.locked ?? '0') }; }
function row(raw: unknown) {
    if (!obj(raw))
        throw Error('Invalid native exit receipt');
    return raw;
}
/** Numeric identities are immutable even when cancellation changes a child client ID. */
export function parentExitOrders(o: ExitObservation, plan: NativeExitPlan, allowCancelAliases: boolean) {
    const list = row(o.parentList), symbol = plan.limitSell.symbol, oco = plan.parentKind === 'oco', ids = oco ? [plan.stopOrderId, plan.targetOrderId] : [plan.entryOrderId, plan.stopOrderId, plan.targetOrderId];
    if (list.symbol !== symbol || list.orderListId !== plan.parentListId || ![plan.parentClientOrderId ?? plan.parentId, ...allowCancelAliases ? [plan.cancel.newClientOrderId] : []].includes(String(list.listClientOrderId)) || !Array.isArray(list.orders) || ![2, 3].includes(list.orders.length) || !['EXECUTING', 'ALL_DONE'].includes(String(list.listOrderStatus)) || !['EXEC_STARTED', 'UPDATED', 'ALL_DONE'].includes(String(list.listStatusType)) || list.listOrderStatus === 'ALL_DONE' && list.listStatusType !== 'ALL_DONE')
        throw Error('Native exit parent list identity/status mismatch');
    const listed = new Set<number>();
    for (const value of list.orders) {
        const r = row(value);
        if (r.symbol !== symbol || !Number.isSafeInteger(r.orderId) || !ids.includes(Number(r.orderId)) || listed.has(Number(r.orderId)))
            throw Error('Native exit parent child-list mismatch');
        listed.add(Number(r.orderId));
    }
    if (!listed.has(plan.stopOrderId) || !listed.has(plan.targetOrderId))
        throw Error('Native exit parent protective members missing');
    if (o.parentOrders.length !== ids.length)
        throw Error('Native exit parent receipt count mismatch');
    const orders = ids.map((id, i) => {
        const matches = o.parentOrders.filter(r => r.orderId === id);
        if (matches.length !== 1)
            throw Error('Native exit duplicate/missing parent receipt');
        const r = row(matches[0]), protective = oco || i > 0, protectiveIndex = oco ? i : i - 1, original = plan.parentId + (oco ? ['_s', '_t'] : ['_e', '_s', '_t'])[i], terminal = ['FILLED', 'CANCELED', 'EXPIRED', 'EXPIRED_IN_MATCH', 'REJECTED'].includes(String(r.status));
        if (r.symbol !== symbol || r.orderListId !== plan.parentListId || r.side !== (protective ? 'SELL' : 'BUY') || r.type !== (oco ? ['STOP_LOSS', 'TAKE_PROFIT'] : ['LIMIT', 'STOP_LOSS', 'TAKE_PROFIT'])[i] || r.clientOrderId !== original && (!allowCancelAliases || !terminal || typeof r.clientOrderId !== 'string' || !r.clientOrderId || r.clientOrderId.length > 100) || !['NEW', 'PARTIALLY_FILLED', 'PENDING_NEW', 'PENDING_CANCEL', 'FILLED', 'CANCELED', 'EXPIRED', 'EXPIRED_IN_MATCH', 'REJECTED'].includes(String(r.status)))
            throw Error('Native exit parent order identity/status mismatch');
        const quantity = exitDecimal(r.origQty, true), executed = exitDecimal(r.executedQty);
        if (compareDecimal(executed, quantity) > 0 || r.status === 'FILLED' && compareDecimal(executed, quantity) !== 0 || ['NEW', 'PENDING_NEW'].includes(String(r.status)) && compareDecimal(executed, '0') !== 0)
            throw Error('Native exit parent quantity mismatch');
        if (protective && (compareDecimal(quantity, plan.observedProtectedQty) !== 0 || compareDecimal(exitDecimal(r.stopPrice, true), protectiveIndex === 0 ? plan.oldStopPrice : plan.oldTargetPrice) !== 0))
            throw Error('Native exit changed parent protection');
        if (!protective && (r.status !== 'FILLED' || compareDecimal(executed, quantity) !== 0 || r.timeInForce !== 'FOK' || compareDecimal(quantity, plan.observedEntryQty) !== 0 || compareDecimal(exitDecimal(r.price, true), plan.observedEntryPrice) !== 0))
            throw Error('Native exit working entry no longer confirmed');
        return r;
    });
    return { list, orders, protectiveOrders: oco ? orders : orders.slice(1), terminal: list.listOrderStatus === 'ALL_DONE' && orders.every(r => ['FILLED', 'CANCELED', 'EXPIRED', 'EXPIRED_IN_MATCH', 'REJECTED'].includes(String(r.status))) };
}
export function exitFillProof(order: RawOrder, trades: unknown[], symbol: BinanceSymbol, now: number) {
    const executed = exitDecimal(order.executedQty), quote = exitDecimal(order.cummulativeQuoteQty);
    if (!Array.isArray(trades) || trades.length > 10000)
        throw Error('Native exit fills missing/oversize');
    let qty = '0', quoteQty = '0', baseFee = '0';
    const fees: Record<string, string> = {}, seen = new Set<number>();
    for (const value of trades) {
        const t = row(value);
        if (t.symbol !== symbol.symbol || t.orderId !== order.orderId || t.orderListId !== undefined && t.orderListId !== order.orderListId || !Number.isSafeInteger(t.id) || Number(t.id) < 0 || seen.has(Number(t.id)) || !Number.isSafeInteger(t.time) || Number(t.time) < 0 || Number(t.time) > now || t.isBuyer !== (order.side === 'BUY') || typeof t.isMaker !== 'boolean' || typeof t.commissionAsset !== 'string' || !t.commissionAsset || t.commissionAsset.length > 100 || /[\/\u0000-\u001f\u007f]/.test(t.commissionAsset))
            throw Error('Native exit foreign/duplicate/future trade');
        seen.add(Number(t.id));
        const q = exitDecimal(t.qty, true), cost = exitDecimal(t.quoteQty, true), fee = exitDecimal(t.commission);
        exitDecimal(t.price, true);
        qty = addDecimal(qty, q);
        quoteQty = addDecimal(quoteQty, cost);
        fees[t.commissionAsset] = addDecimal(fees[t.commissionAsset] ?? '0', fee);
        if (t.commissionAsset === symbol.baseAsset)
            baseFee = addDecimal(baseFee, fee);
    }
    if (compareDecimal(qty, executed) !== 0 || compareDecimal(quoteQty, quote) !== 0)
        throw Error('Native exit incomplete quantity/quote fill ledger');
    return { executedQty: qty, quoteQty, baseFee, fees, tradeCount: trades.length };
}
export function assertExitStandaloneOrder(raw: RawOrder, command: ExitSellCommand, knownOrderId?: number) {
    if (raw.symbol !== command.symbol || raw.orderListId !== -1 || !Number.isSafeInteger(raw.orderId) || Number(raw.orderId) < 0 || knownOrderId !== undefined && raw.orderId !== knownOrderId)
        throw Error('Native exit standalone identity mismatch');
    const list: ListIdentity = { symbol: command.symbol, orderListId: -1, listClientOrderId: 'standalone', listStatusType: 'ALL_DONE', listOrderStatus: 'ALL_DONE', orders: [{ symbol: command.symbol, orderId: Number(raw.orderId), clientOrderId: command.newClientOrderId }] };
    const child: ChildContract = { clientOrderId: command.newClientOrderId, side: 'SELL', type: 'LIMIT', quantity: command.quantity, price: command.price, timeInForce: 'FOK' };
    const checked = assertNativeOrder(raw, list, child);
    return { order: raw, terminal: ['FILLED', 'CANCELED', 'EXPIRED', 'EXPIRED_IN_MATCH', 'REJECTED'].includes(checked.status) };
}
/** Independent fill/fee arithmetic; no current free/locked balance is invented for historical proof. */
export function exitLedgerQuantity(o: ExitObservation, plan: NativeExitPlan, symbol: BinanceSymbol, now: number, command?: ExitSellCommand, knownOrderId?: number) {
    const parent = parentExitOrders(o, plan, true);
    if (!parent.terminal)
        throw Error('Native exit cancellation not terminal');
    const orders = [...parent.protectiveOrders];
    if (command) {
        if (!o.sellOrder)
            throw Error('Native exit sell not observed');
        const sale = assertExitStandaloneOrder(o.sellOrder, command, knownOrderId);
        if (!sale.terminal)
            throw Error('Native exit FOK outcome not terminal');
        if ((plan.ancestorOrderIds ?? [plan.entryOrderId, plan.stopOrderId, plan.targetOrderId]).includes(Number(sale.order.orderId)))
            throw Error('Native exit reused ancestor order id');
        orders.push(sale.order);
    }
    let removed = '0';
    const fills = orders.map(order => { const proof = exitFillProof(order, o.trades[String(order.orderId)] ?? [], symbol, now); removed = addDecimal(removed, addDecimal(proof.executedQty, proof.baseFee)); return proof; });
    if (compareDecimal(removed, plan.observedPositionQty) > 0)
        throw Error('Native exit fees/fills exceed initial inventory');
    return { quantity: subtractDecimal(plan.observedPositionQty, removed), parent, fills };
}
export function canceledExitInventory(o: ExitObservation, plan: NativeExitPlan, symbol: BinanceSymbol, now: number) {
    const ledger = exitLedgerQuantity(o, plan, symbol, now), balance = exitBaseBalance(o, symbol);
    if (compareDecimal(balance.total, ledger.quantity) !== 0 || compareDecimal(balance.locked, '0') !== 0)
        throw Error('Native exit released balance/fee ledger mismatch');
    return { ...ledger, balance };
}
export function soldExitInventory(o: ExitObservation, plan: NativeExitPlan, symbol: BinanceSymbol, command: ExitSellCommand, now: number, knownOrderId?: number) {
    const ledger = exitLedgerQuantity(o, plan, symbol, now, command, knownOrderId), balance = exitBaseBalance(o, symbol);
    if (compareDecimal(balance.total, ledger.quantity) !== 0 || compareDecimal(balance.locked, '0') !== 0)
        throw Error('Native exit post-fill balance/fee ledger mismatch');
    return { ...ledger, balance };
}
export function reprotectionContract(command: ExitProtectCommand): ListContract { return { symbol: command.symbol, listClientOrderId: command.listClientOrderId, children: [{ clientOrderId: command.belowClientOrderId, side: 'SELL', type: 'STOP_LOSS', quantity: command.quantity, stopPrice: command.belowStopPrice }, { clientOrderId: command.aboveClientOrderId, side: 'SELL', type: 'TAKE_PROFIT', quantity: command.quantity, stopPrice: command.aboveStopPrice }] }; }
export function exitProtectionProof(o: ExitObservation, command: ExitProtectCommand, plan: NativeExitPlan, symbol: BinanceSymbol, previousQuantity: string, now: number, acknowledgement?: unknown) {
    const contract = reprotectionContract(command), list = assertNativeList(o.protectionList, contract);
    if ((plan.ancestorListIds ?? [plan.parentListId]).includes(list.orderListId) || !Array.isArray(o.protectionOrders) || o.protectionOrders.length !== 2)
        throw Error('Native exit replacement list/children invalid');
    const reports = contract.children.map(c => {
        const matches = o.protectionOrders!.filter(r => r.clientOrderId === c.clientOrderId);
        if (matches.length !== 1)
            throw Error('Native exit replacement child missing/duplicate');
        const order = matches[0]!;
        assertNativeOrder(order, list, c);
        if ([...(plan.ancestorOrderIds ?? [plan.entryOrderId, plan.stopOrderId, plan.targetOrderId]), ...(o.sellOrder ? [Number(o.sellOrder.orderId)] : [])].includes(Number(order.orderId)))
            throw Error('Native exit old child reused as new protection');
        return order;
    });
    if (acknowledgement !== undefined) {
        const ack = row(acknowledgement);
        if (ack.symbol !== list.symbol || ack.orderListId !== list.orderListId || ack.listClientOrderId !== list.listClientOrderId)
            throw Error('Native replacement acknowledgement identity changed');
        if (ack.orders !== undefined) {
            if (!Array.isArray(ack.orders) || ack.orders.length !== 2)
                throw Error('Native replacement acknowledgement children invalid');
            for (const report of reports) {
                const matching = ack.orders.filter(v => obj(v) && v.clientOrderId === report.clientOrderId);
                if (matching.length !== 1 || !obj(matching[0]) || matching[0].symbol !== report.symbol || matching[0].orderId !== report.orderId)
                    throw Error('Native replacement acknowledgement child changed');
            }
        }
    }
    let removed = '0';
    for (const order of reports) {
        const proof = exitFillProof(order, o.trades[String(order.orderId)] ?? [], symbol, now);
        removed = addDecimal(removed, addDecimal(proof.executedQty, proof.baseFee));
    }
    if (compareDecimal(removed, previousQuantity) > 0)
        throw Error('Native exit replacement fills exceed inventory');
    const expected = subtractDecimal(previousQuantity, removed), balance = exitBaseBalance(o, symbol);
    if (compareDecimal(balance.total, expected) !== 0)
        throw Error('Native exit replacement balance/fee mismatch');
    const active = reports.every(r => r.status === 'NEW' && compareDecimal(exitDecimal(r.executedQty), '0') === 0) && list.listOrderStatus === 'EXECUTING';
    if (active && (compareDecimal(balance.locked, command.quantity) !== 0 || compareDecimal(balance.free, subtractDecimal(expected, command.quantity)) !== 0))
        throw Error('Native exit protected quantity not locked');
    const closed = reports.some(r => r.status === 'FILLED') && reports.every(r => ['FILLED', 'CANCELED', 'EXPIRED', 'EXPIRED_IN_MATCH', 'REJECTED'].includes(String(r.status))) && list.listOrderStatus === 'ALL_DONE';
    return { active, closed, quantity: expected, balance, list, reports };
}
export function currentExitSymbol(o: ExitObservation, original: BinanceSymbol) {
    const s = o.symbol;
    if (!s || s.symbol !== original.symbol || s.baseAsset !== original.baseAsset || s.quoteAsset !== original.quoteAsset || s.status !== 'TRADING' || s.isSpotTradingAllowed === false || !s.ocoAllowed || !['LIMIT', 'STOP_LOSS', 'TAKE_PROFIT'].every(t => s.orderTypes.includes(t)) || !Array.isArray(s.filters))
        throw Error('Native exit refreshed symbol unavailable/changed');
    return s;
}
export function assertExitPriceFilter(price: string, symbol: BinanceSymbol) {
    const f = symbol.filters.find(f => f.filterType === 'PRICE_FILTER');
    if (!f?.tickSize || compareDecimal(f.tickSize, '0') <= 0 || compareDecimal(exitDecimal(price, true), floorStep(price, f.tickSize)) !== 0 || f.minPrice && compareDecimal(f.minPrice, '0') > 0 && compareDecimal(price, f.minPrice) < 0 || f.maxPrice && compareDecimal(f.maxPrice, '0') > 0 && compareDecimal(price, f.maxPrice) > 0)
        throw Error('Native exit refreshed price filter mismatch');
}
