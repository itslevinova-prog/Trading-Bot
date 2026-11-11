import { entryContract, assertNativeList, assertNativeOrder } from './native-contract.js';
import { nativeBracketConsumed, ownedReplacementOrder, resolveNativeBracket } from './bracket-lineage.js';
import { addDecimal, subtractDecimal, compareDecimal } from './decimal.js';
import type { Journal } from './journal.js';
export type NativeOrder = {
    symbol: string;
    clientOrderId: string;
    side: string;
    type: string;
    status?: string;
    origQty?: string;
    executedQty?: string;
    stopPrice?: string;
    orderId?: number;
    orderListId?: number;
};
/** A name prefix is not ownership: compare the durable pre-submission payload. */
export function ownedNativeOrder(order: NativeOrder, journal: Journal, now = Date.now()) {
    if (typeof order.clientOrderId !== 'string' || !/^bot_[a-f0-9]{24}_[est]$/.test(order.clientOrderId))
        return false;
    const id = order.clientOrderId.slice(0, -2), intent = journal.get(id);
    if (!intent || intent.id !== id || intent.pair.replace('/', '') !== order.symbol)
        return false;
    if (intent.side === 'sell') {
        try {
            return ownedReplacementOrder(order, journal, now);
        }
        catch {
            return false;
        }
    }
    if (intent.side !== 'buy' || intent.state !== 'accepted' || nativeBracketConsumed(id, journal))
        return false;
    try {
        const contract = entryContract(intent), list = assertNativeList(JSON.parse(intent.result), contract), child = contract.children.find(c => c.clientOrderId === order.clientOrderId);
        if (!child)
            return false;
        const checked = assertNativeOrder(order, list, child);
        return child.side !== 'SELL' || checked.originalQty === null || compareDecimal(checked.originalQty, contract.children[0]!.quantity!) <= 0;
    }
    catch {
        return false;
    }
}
export function stopCoverage(position: {
    pair: string;
    qty: number;
    value: number;
}, orders: NativeOrder[], journal: Journal, now = Date.now()) {
    let quantity = 0, quantityText = '0', stopValue = 0;
    const bid = position.value / position.qty;
    if (!Number.isFinite(position.qty) || position.qty <= 0 || !Number.isFinite(bid) || bid <= 0)
        return { valid: false, covered: false, quantity: 0, quantityText: '0', stopValue: 0 };
    const ids = new Set<string>();
    for (const order of orders) {
        if (order.symbol !== position.pair.replace('/', '') || order.type !== 'STOP_LOSS' || !ownedNativeOrder(order, journal, now))
            continue;
        if (ids.has(order.clientOrderId))
            return { valid: false, covered: false, quantity, quantityText, stopValue };
        ids.add(order.clientOrderId);
        const original = Number(order.origQty), executed = Number(order.executedQty), price = Number(order.stopPrice), remaining = original - executed;
        const intent = journal.get(order.clientOrderId.slice(0, -2))!;
        let plannedStop: number;
        try {
            plannedStop = intent.side === 'sell' ? Number(resolveNativeBracket(intent.id, journal, now).contract.children.find(c => c.type === 'STOP_LOSS')!.stopPrice) : Number(JSON.parse(intent.payload).pendingBelowStopPrice);
        }
        catch {
            return { valid: false, covered: false, quantity, quantityText, stopValue };
        }
        if (!['NEW', 'PARTIALLY_FILLED'].includes(order.status ?? '') || ![original, executed, price, plannedStop].every(Number.isFinite) || original <= 0 || executed < 0 || remaining <= 0 || price <= 0 || price >= bid || price !== plannedStop)
            return { valid: false, covered: false, quantity, quantityText, stopValue };
        try {
            quantityText = addDecimal(quantityText, subtractDecimal(order.origQty!, order.executedQty!));
        }
        catch {
            return { valid: false, covered: false, quantity, quantityText, stopValue };
        }
        quantity = Number(quantityText);
        stopValue += remaining * price;
    }
    const tolerance = Math.max(1e-14, position.qty * 1e-10);
    // No fee-based 0.5% uncovered allowance. Excess coverage also indicates mixed inventory/orders.
    return { valid: Number.isFinite(quantity) && Number.isFinite(stopValue), covered: Number.isFinite(quantity) && Math.abs(quantity - position.qty) <= tolerance, quantity, quantityText, stopValue };
}
