import { createHash } from 'node:crypto';
import type { Intent, Journal } from './journal.js';
import { entryContract, assertNativeList, assertNativeOrder, type ListContract, type ListIdentity } from './native-contract.js';
import { exitLedgerQuantity, exitProtectionProof, currentExitSymbol, exitBaseBalance, type ExitObservation, type ExitProtectCommand } from './exit-evidence.js';
import { compareDecimal, subtractDecimal, multiplyToStep } from './decimal.js';
import { belowNativeQuantity } from './balances.js';
import type { NativeExitPlan } from './exit-plan.js';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export const MAX_NATIVE_BRACKET_DEPTH = 128;
export type NativeBracketLineage = {
    owner: Intent;
    root: Intent;
    contract: ListContract;
    list: ListIdentity;
    entryOrderId: number;
    entryQuantity: string;
    entryPrice: string;
    stopOrderId: number;
    targetOrderId: number;
    depth: number;
    remainingQty: string | null;
    protectedQty: string | null;
    recordedAt: number | null;
    orderIds: number[];
    listIds: number[];
};
const object = (v: unknown): Record<string, any> => {
    if (!v || typeof v !== 'object' || Array.isArray(v))
        throw Error('Invalid native lineage object');
    return v as Record<string, any>;
};
function assertExitParent(row: Intent, e: Record<string, any>, r: Record<string, any>, current: NativeBracketLineage) {
    const root = current.root, p = e.plan as NativeExitPlan, stopContract = current.contract.children.find(c => c.type === 'STOP_LOSS')!, targetContract = current.contract.children.find(c => c.type === 'TAKE_PROFIT')!;
    if (![undefined, 'reduce', 'tighten'].includes(p?.purpose) || e.kind !== 'opoco-exit-driver-v1' || r.kind !== 'native-exit-receipt-v1' || !p || p.kind !== 'opoco-exit-plan-v1' || p.id !== row.id || p.pair !== row.pair || row.pair !== root.pair || p.parentId !== current.owner.id || e.parentPayloadHash !== hash(current.owner.payload) || p.mutationAuthorized !== false || p.rootEntryId !== undefined && p.rootEntryId !== root.id || (p.parentKind ?? 'opoco') !== (current.depth ? 'oco' : 'opoco') || (p.parentClientOrderId ?? p.parentId) !== current.contract.listClientOrderId || p.parentListId !== current.list.orderListId || p.entryOrderId !== current.entryOrderId || p.stopOrderId !== current.stopOrderId || p.targetOrderId !== current.targetOrderId || compareDecimal(p.oldStopPrice, stopContract.stopPrice!) !== 0 || compareDecimal(p.oldTargetPrice, targetContract.stopPrice!) !== 0 || compareDecimal(p.observedEntryQty, current.entryQuantity) !== 0 || compareDecimal(p.observedEntryPrice, current.entryPrice) !== 0 || !Number.isSafeInteger(p.preparedAt) || p.preparedAt > row.createdAt || row.createdAt < current.owner.createdAt || p.ancestryDepth !== undefined && p.ancestryDepth !== current.depth)
        throw Error('Native replacement lineage identity changed');
    if (current.remainingQty !== null && compareDecimal(p.observedPositionQty, current.remainingQty) !== 0 || current.protectedQty !== null && compareDecimal(p.observedProtectedQty, current.protectedQty) !== 0 || compareDecimal(p.observedPositionQty, current.entryQuantity) > 0)
        throw Error('Native replacement parent inventory changed');
    if (p.ancestorOrderIds !== undefined && JSON.stringify(p.ancestorOrderIds) !== JSON.stringify(current.orderIds) || p.ancestorListIds !== undefined && JSON.stringify(p.ancestorListIds) !== JSON.stringify(current.listIds) || current.depth > 0 && (!p.ancestorOrderIds || !p.ancestorListIds))
        throw Error('Native ancestor numeric footprint changed');
    if (e.rootPayloadHash !== undefined && e.rootPayloadHash !== hash(root.payload) || p.parentKind === 'oco' && e.rootPayloadHash !== hash(root.payload))
        throw Error('Native exit root commitment changed');
    const tightening = p.purpose === 'tighten';
    if (typeof p.decisionId !== 'string' || !p.decisionId || p.decisionId.length > 200 || row.id !== 'bot_' + hash(tightening ? `${p.decisionId}:${row.pair}:protect:${p.reprotectStopPrice}` : `${p.decisionId}:${row.pair}:sell`).slice(0, 24) || p.actionHash !== hash(JSON.stringify(tightening ? { decisionId: p.decisionId, pair: row.pair, stopPrice: p.reprotectStopPrice, purpose: 'tighten' } : { decisionId: p.decisionId, pair: row.pair, sellFraction: p.requestedFraction })) || compareDecimal(p.predictedRemainingQty, p.observedPositionQty) > 0 || compareDecimal(p.observedProtectedQty, p.observedPositionQty) > 0 || compareDecimal(p.observedPositionQty, '0') <= 0 || compareDecimal(p.limitSell.quantity, subtractDecimal(p.observedPositionQty, p.predictedRemainingQty)) !== 0)
        throw Error('Native replacement action commitment changed');
    if (tightening ? compareDecimal(p.requestedFraction, '0') !== 0 : compareDecimal(p.requestedFraction, '0') <= 0 || compareDecimal(p.requestedFraction, '1') > 0 || compareDecimal(p.limitSell.quantity, multiplyToStep(p.observedPositionQty, p.requestedFraction, e.symbol.filters.find((f: any) => f.filterType === 'LOT_SIZE').stepSize)) !== 0)
        throw Error('Native replacement fraction/quantum changed');
    return p;
}
/** Historical receipt consistency, never a statement that a past bracket remains live now. */
export function resolveNativeBracket(ownerId: string, journal: Journal, now = Date.now(), maxDepth = MAX_NATIVE_BRACKET_DEPTH, allowClosedRoot = false): NativeBracketLineage {
    if (!Number.isSafeInteger(now) || now < 0 || !Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > MAX_NATIVE_BRACKET_DEPTH)
        throw Error('Invalid native lineage bound/clock');
    const chain: Intent[] = [], seen = new Set<string>();
    let id = ownerId, root: Intent;
    while (true) {
        if (seen.has(id))
            throw Error('Cyclic native bracket lineage');
        seen.add(id);
        const row = journal.get(id);
        if (!row || row.id !== id || !Number.isSafeInteger(row.createdAt) || row.createdAt < 0 || row.createdAt > now)
            throw Error('Missing/future native bracket origin');
        if (row.side === 'buy') {
            if (row.state !== 'accepted' && !(allowClosedRoot && row.state === 'closed'))
                throw Error('Native lineage entry is not active');
            root = row;
            break;
        }
        if (row.side !== 'sell' || row.state !== 'exit_protected' || chain.length >= maxDepth)
            throw Error('Unproven/bounded native replacement origin');
        chain.push(row);
        const e = object(JSON.parse(row.payload));
        if (e.kind !== 'opoco-exit-driver-v1' || typeof e.plan?.parentId !== 'string')
            throw Error('Unsupported native replacement payload');
        id = e.plan.parentId;
    }
    const contract = entryContract(root), list = assertNativeList(JSON.parse(root.result), contract), entry = list.orders.find(o => o.clientOrderId === root.id + '_e')!, stop = list.orders.find(o => o.clientOrderId === root.id + '_s')!, target = list.orders.find(o => o.clientOrderId === root.id + '_t')!;
    let current: NativeBracketLineage = { owner: root, root, contract, list, entryOrderId: entry.orderId, entryQuantity: contract.children[0]!.quantity!, entryPrice: contract.children[0]!.price!, stopOrderId: stop.orderId, targetOrderId: target.orderId, depth: 0, remainingQty: null, protectedQty: null, recordedAt: null, orderIds: list.orders.map(o => o.orderId).sort((a, b) => a - b), listIds: [list.orderListId] };
    for (const row of chain.reverse()) {
        const e = object(JSON.parse(row.payload)), r = object(JSON.parse(row.result)), p = e.plan as NativeExitPlan, command = r.protectCommand as ExitProtectCommand, o = r.lastObservation as ExitObservation, audit = journal.audit?.(row.id);
        if (!audit?.recordedFromOrigin || !audit.localIntegrityChecked || !audit.events.some(event => {
            if (event.toState !== 'exit_reprotect_pending')
                return false;
            try {
                return JSON.stringify(JSON.parse(event.result).protectCommand) === JSON.stringify(command);
            }
            catch {
                return false;
            }
        }))
            throw Error('Replacement lacks durable origin/presend evidence');
        assertExitParent(row, e, r, current);
        if (!o || !Number.isSafeInteger(o.asOf) || !Number.isSafeInteger(o.completedAt) || o.asOf < row.createdAt || o.completedAt < o.asOf || o.completedAt > now || !command || r.protectNotSent === true || command.listClientOrderId !== row.id + '_r' || command.belowClientOrderId !== row.id + '_s' || command.aboveClientOrderId !== row.id + '_t' || command.symbol !== contract.symbol || command.side !== 'SELL' || command.belowType !== 'STOP_LOSS' || command.aboveType !== 'TAKE_PROFIT' || compareDecimal(command.belowStopPrice, p.reprotectStopPrice ?? p.oldStopPrice) !== 0 || compareDecimal(command.belowStopPrice, p.oldStopPrice) < 0 || compareDecimal(command.aboveStopPrice, p.oldTargetPrice) !== 0)
            throw Error('Native replacement observation/command changed');
        const symbol = currentExitSymbol(o, e.symbol);
        if (symbol.symbol !== contract.symbol || symbol.baseAsset + '/' + symbol.quoteAsset !== row.pair)
            throw Error('Native replacement symbol/asset mismatch');
        const sale = r.sellCommand && !r.sellNotSent ? r.sellCommand : undefined, saleId = Number.isSafeInteger(r.sellAck?.orderId) ? r.sellAck.orderId : undefined, ledger = exitLedgerQuantity(o, p, symbol, o.completedAt, sale, saleId);
        if (typeof r.remainingQty !== 'string' || compareDecimal(r.remainingQty, ledger.quantity) !== 0)
            throw Error('Native replacement remaining quantity unproven');
        const proof = exitProtectionProof(o, command, p, symbol, ledger.quantity, o.completedAt, r.protectAck);
        if (!proof.active || compareDecimal(proof.quantity, command.quantity) < 0 || compareDecimal(subtractDecimal(proof.quantity, command.quantity), '0') > 0 && !belowNativeQuantity(subtractDecimal(proof.quantity, command.quantity), symbol))
            throw Error('Native replacement protection unproven');
        current = { owner: row, root, contract: { symbol: command.symbol, listClientOrderId: command.listClientOrderId, children: [{ clientOrderId: command.belowClientOrderId, side: 'SELL', type: 'STOP_LOSS', quantity: command.quantity, stopPrice: command.belowStopPrice }, { clientOrderId: command.aboveClientOrderId, side: 'SELL', type: 'TAKE_PROFIT', quantity: command.quantity, stopPrice: command.aboveStopPrice }] }, list: proof.list, entryOrderId: current.entryOrderId, entryQuantity: current.entryQuantity, entryPrice: current.entryPrice, stopOrderId: Number(proof.reports[0]!.orderId), targetOrderId: Number(proof.reports[1]!.orderId), depth: current.depth + 1, remainingQty: proof.quantity, protectedQty: command.quantity, recordedAt: o.completedAt, orderIds: [...current.orderIds, ...(sale && o.sellOrder ? [Number(o.sellOrder.orderId)] : []), ...proof.reports.map(r => Number(r.orderId))].sort((a, b) => a - b), listIds: [...current.listIds, proof.list.orderListId].sort((a, b) => a - b) };
    }
    return current;
}
/** Completed descendants consume the old bracket; the bot prefix alone never revives it. */
export function nativeBracketConsumed(ownerId: string, journal: Journal) {
    return (journal.recent?.(0) ?? []).some(row => {
        if (row.side !== 'sell' || !['exit_protected', 'exit_closed'].includes(row.state))
            return false;
        try {
            const e = JSON.parse(row.payload);
            return e.kind === 'opoco-exit-driver-v1' && e.plan?.parentId === ownerId;
        }
        catch {
            return false;
        }
    });
}
export function ownedReplacementOrder(order: {
    symbol: string;
    clientOrderId: string;
    side: string;
    type: string;
    orderId?: number;
    orderListId?: number;
    origQty?: string;
    executedQty?: string;
    status?: string;
    stopPrice?: string;
}, journal: Journal, now = Date.now()) {
    const id = order.clientOrderId.slice(0, -2);
    if (nativeBracketConsumed(id, journal))
        return false;
    const current = resolveNativeBracket(id, journal, now), child = current.contract.children.find(c => c.clientOrderId === order.clientOrderId);
    if (current.depth === 0 || !child)
        return false;
    assertNativeOrder(order, current.list, child);
    return true;
}
export type NativeExitCompletion = {
    rootEntryId: string;
    exitIntentId: string;
    pair: string;
    recordedAt: number;
    remainingQty: string;
    quantityDust: boolean;
    depth: number;
    source: 'recorded-native-exit-driver';
    actualPnlVerified: false;
};
/** Validate a completed position episode, independently of the historical entry-intent phase. */
export function nativeExitCompletion(exitId: string, journal: Journal, now = Date.now()): NativeExitCompletion {
    const row = journal.get(exitId);
    if (!row || row.side !== 'sell' || row.state !== 'exit_closed' || !Number.isSafeInteger(now) || now < 0 || row.createdAt > now)
        throw Error('Native exit completion missing/future');
    const e = object(JSON.parse(row.payload)), r = object(JSON.parse(row.result)), p = e.plan as NativeExitPlan, audit = journal.audit?.(row.id);
    if (e.kind !== 'opoco-exit-driver-v1' || r.kind !== 'native-exit-receipt-v1' || !audit?.recordedFromOrigin || !audit.localIntegrityChecked || !p)
        throw Error('Native exit completion lacks original evidence');
    const parent = resolveNativeBracket(p.parentId, journal, now, MAX_NATIVE_BRACKET_DEPTH, true);
    assertExitParent(row, e, r, parent);
    const o = r.lastObservation as ExitObservation;
    if (!o || !Number.isSafeInteger(o.asOf) || o.asOf < row.createdAt || !Number.isSafeInteger(o.completedAt) || o.completedAt < o.asOf || o.completedAt > now)
        throw Error('Native completion observation unavailable');
    const symbol = currentExitSymbol(o, e.symbol), sale = r.sellCommand && !r.sellNotSent ? r.sellCommand : undefined, saleId = Number.isSafeInteger(r.sellAck?.orderId) ? r.sellAck.orderId : undefined, ledger = exitLedgerQuantity(o, p, symbol, o.completedAt, sale, saleId);
    let quantity = ledger.quantity;
    if (r.protectCommand && !r.protectNotSent) {
        const command = r.protectCommand as ExitProtectCommand;
        if (command.listClientOrderId !== row.id + '_r' || command.belowClientOrderId !== row.id + '_s' || command.aboveClientOrderId !== row.id + '_t' || compareDecimal(command.belowStopPrice, p.reprotectStopPrice ?? p.oldStopPrice) !== 0 || compareDecimal(command.belowStopPrice, p.oldStopPrice) < 0 || compareDecimal(command.aboveStopPrice, p.oldTargetPrice) !== 0 || !audit.events.some(event => event.toState === 'exit_reprotect_pending' && JSON.stringify(JSON.parse(event.result).protectCommand) === JSON.stringify(command)))
            throw Error('Native completion replacement contract changed');
        const proof = exitProtectionProof(o, command, p, symbol, quantity, o.completedAt, r.protectAck);
        if (!proof.closed)
            throw Error('Native replacement closure unproven');
        quantity = proof.quantity;
    }
    else {
        const balance = exitBaseBalance(o, symbol);
        if (compareDecimal(balance.total, quantity) !== 0 || compareDecimal(balance.locked, '0') !== 0)
            throw Error('Native completion balance/ledger mismatch');
    }
    if (typeof r.remainingQty !== 'string' || compareDecimal(r.remainingQty, quantity) !== 0 || compareDecimal(quantity, '0') > 0 && !belowNativeQuantity(quantity, symbol))
        throw Error('Native completion retains executable inventory');
    return { rootEntryId: parent.root.id, exitIntentId: row.id, pair: row.pair, recordedAt: o.completedAt, remainingQty: quantity, quantityDust: compareDecimal(quantity, '0') > 0, depth: parent.depth, source: 'recorded-native-exit-driver', actualPnlVerified: false };
}
export function nativeCompletedEntries(journal: Journal, now = Date.now()) {
    const completed: Record<string, NativeExitCompletion> = {};
    for (const row of journal.recent(0)) {
        if (row.side !== 'sell' || row.state !== 'exit_closed')
            continue;
        try {
            const proof = nativeExitCompletion(row.id, journal, now), previous = completed[proof.rootEntryId];
            if (!previous || proof.recordedAt > previous.recordedAt)
                completed[proof.rootEntryId] = proof;
        }
        catch { /* An unproven terminal label is not a completed position. */ }
    }
    return completed;
}
