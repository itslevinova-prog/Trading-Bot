import { createHash } from 'node:crypto';
import type { Journal, Intent } from './journal.js';
import { prepareOpocoExit, prepareOpocoStopTightening, type NativeExitPlan } from './exit-plan.js';
import type { BinanceSymbol } from '../market/binance-data.js';
import { partialBook } from '../market/binance-data.js';
import { NativePreSendRejected } from './BinanceClient.js';
import { addDecimal, subtractDecimal, compareDecimal, floorStep, multiplyToStep, basisPointFraction, numberDecimal } from './decimal.js';
import { belowNativeQuantity, nativeQuantityStep, nativeQuantityAllowed, nativeNotionalAllowed, limitQuantityAllowed, limitNotionalAllowed } from './balances.js';
import { assertExitPriceFilter, currentExitSymbol, assertExitFresh, exitBaseBalance, parentExitOrders, canceledExitInventory, soldExitInventory, assertExitStandaloneOrder, exitProtectionProof, exitLedgerQuantity, exitDecimal, type ExitObservation, type ExitSellCommand, type ExitProtectCommand } from './exit-evidence.js';
export type NativeExitJournal = Journal & {
    transition(id: string, from: string, to: string, result: string): void;
    reserveExit(i: Intent): void;
};
export interface NativeExitTransport {
    observe(plan: NativeExitPlan, commands: {
        sell?: ExitSellCommand;
        protect?: ExitProtectCommand;
    }): Promise<ExitObservation>;
    cancel(command: NativeExitPlan['cancel'], beforeSend: () => void): Promise<unknown>;
    sell(command: ExitSellCommand, beforeSend: () => void): Promise<unknown>;
    protect(command: ExitProtectCommand, beforeSend: () => void): Promise<unknown>;
}
type Envelope = {
    kind: 'opoco-exit-driver-v1';
    plan: NativeExitPlan;
    symbol: BinanceSymbol;
    limits: Parameters<typeof prepareOpocoExit>[0]['limits'];
    parentPayloadHash: string;
    rootPayloadHash?: string;
};
type Receipt = {
    kind: 'native-exit-receipt-v1';
    reason?: string;
    cancelAck?: unknown;
    cancelNotSent?: boolean;
    sellCommand?: ExitSellCommand;
    sellAck?: unknown;
    sellNotSent?: boolean;
    protectCommand?: ExitProtectCommand;
    protectAck?: unknown;
    protectNotSent?: boolean;
    remainingQty?: string;
    lastObservation?: ExitObservation;
    protectionProof?: unknown;
    actionFulfilled?: boolean;
};
export type NativeExitResult = {
    id: string;
    phase: string;
    protected: boolean;
    actionFulfilled: boolean;
    remainingQty: string | null;
    reason: string;
};
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const terminal = new Set(['exit_closed', 'exit_protected', 'exit_unchanged']);
/** Executable effect/recovery driver with injected transport. No production transport or new endpoint grant. */
export class NativeExitDriver {
    private queue: Promise<unknown> = Promise.resolve();
    constructor(private journal: NativeExitJournal, private transport: NativeExitTransport, private options: {
        enabled: boolean;
        now?: () => number;
    }) { }
    private now() { return (this.options.now ?? Date.now)(); }
    private run<T>(work: () => Promise<T>) { const task = this.queue.catch(() => { }).then(work); this.queue = task; return task; }
    start(input: Parameters<typeof prepareOpocoExit>[0]) { return this.run(() => this.begin(input)); }
    tighten(input: Parameters<typeof prepareOpocoExit>[0], stopPrice: string) { return this.run(() => { exitDecimal(stopPrice, true); return this.begin(input, stopPrice); }); }
    resume(id: string) { return this.run(async () => this.options.enabled === true ? this.advance(id) : this.disabled(id)); }
    private disabled(id = ''): NativeExitResult { return { id, phase: 'disabled', protected: false, actionFulfilled: false, remainingQty: null, reason: 'Native exit driver disabled' }; }
    private result(i: Intent, r: Receipt): NativeExitResult { return { id: i.id, phase: i.state, protected: ['exit_protected', 'exit_unchanged'].includes(i.state) || i.state === 'exit_closed' && r.remainingQty !== undefined && compareDecimal(r.remainingQty, '0') === 0, actionFulfilled: r.actionFulfilled === true, remainingQty: r.remainingQty ?? null, reason: r.reason ?? i.state }; }
    private load(id: string) {
        const i = this.journal.get(id);
        if (!i || i.side !== 'sell')
            throw Error('Native exit intent missing');
        const e = JSON.parse(i.payload) as Envelope, r = JSON.parse(i.result) as Receipt;
        const root = this.journal.get(e.plan.rootEntryId ?? e.plan.parentId);
        if (!root || root.side !== 'buy' || root.pair !== i.pair || root.state !== 'accepted' && !(terminal.has(i.state) && root.state === 'closed') || digest(root.payload) !== (e.rootPayloadHash ?? (e.plan.parentKind === 'oco' ? undefined : e.parentPayloadHash)))
            throw Error('Native exit root provenance changed');
        if (e.kind !== 'opoco-exit-driver-v1' || e.plan.id !== id || e.plan.pair !== i.pair || e.plan.mutationAuthorized !== false || r.kind !== 'native-exit-receipt-v1' || digest(this.journal.get(e.plan.parentId)?.payload ?? '') !== e.parentPayloadHash)
            throw Error('Native exit payload/parent provenance mismatch');
        return { i, e, r };
    }
    private save(i: Intent, r: Receipt, state: string) { this.journal.transition(i.id, i.state, state, JSON.stringify(r)); return this.journal.get(i.id)!; }
    private async begin(input: Parameters<typeof prepareOpocoExit>[0], stopPrice?: string) {
        if (this.options.enabled !== true)
            return this.disabled();
        const id = 'bot_' + digest(stopPrice === undefined ? `${input.decisionId}:${input.action.pair}:sell` : `${input.decisionId}:${input.action.pair}:protect:${stopPrice}`).slice(0, 24), existing = this.journal.get(id);
        if (existing) {
            const { e } = this.load(id), expected = stopPrice === undefined ? digest(JSON.stringify({ decisionId: input.decisionId, pair: input.action.pair, sellFraction: numberDecimal(input.action.sellFraction) })) : digest(JSON.stringify({ decisionId: input.decisionId, pair: input.action.pair, stopPrice, purpose: 'tighten' }));
            if (e.plan.actionHash !== expected)
                throw Error('Contradictory repeated native exit action');
            return this.advance(id);
        }
        if (!Number.isSafeInteger(input.now) || input.now > this.now() || this.now() - input.now > 5000)
            throw Error('Native exit preflight clock stale/invalid');
        const plan = stopPrice === undefined ? prepareOpocoExit(input) : prepareOpocoStopTightening(input, stopPrice);
        if (this.journal.recent(0).some(i => {
            if (i.side !== 'sell' || !['exit_closed', 'exit_protected'].includes(i.state))
                return false;
            try {
                const prior = JSON.parse(i.payload);
                return prior.kind === 'opoco-exit-driver-v1' && prior.plan.parentId === plan.parentId;
            }
            catch {
                return false;
            }
        }))
            throw Error('Native OPOCO parent already consumed; follow replacement lineage');
        if (plan.id !== id)
            throw Error('Native exit stable identity mismatch');
        const symbol = input.symbols.find(s => s.symbol === plan.limitSell.symbol)!, parent = this.journal.get(plan.parentId)!;
        const e: Envelope = JSON.parse(JSON.stringify({ kind: 'opoco-exit-driver-v1', plan, symbol, limits: input.limits, parentPayloadHash: digest(parent.payload), rootPayloadHash: digest(this.journal.get(plan.rootEntryId ?? plan.parentId)!.payload) }));
        this.journal.reserveExit({ id, pair: plan.pair, side: 'sell', state: 'exit_prepared', createdAt: this.now(), payload: JSON.stringify(e), result: JSON.stringify({ kind: 'native-exit-receipt-v1' } satisfies Receipt) });
        return this.advance(id);
    }
    private guard(id: string, state: string, o: ExitObservation, book: boolean) {
        if (this.options.enabled !== true)
            throw Error('Native exit capability disabled');
        if (this.journal.get(id)?.state !== state || this.journal.unresolved().some(i => i.id !== id))
            throw Error('Native exit phase/other mutation changed');
        const halt = this.journal.getMeta('halt');
        if (['exit_prepared', 'exit_cancel_pending'].includes(state) && halt && halt !== 'Drawdown limit')
            throw Error('Native pre-cancel halt changed');
        assertExitFresh(o, this.now(), book);
    }
    private assertOpenParent(o: ExitObservation, e: Envelope, parent: ReturnType<typeof parentExitOrders>) { const rows = o.openOrders.filter(r => r.symbol === e.symbol.symbol); if (rows.length !== 2)
        throw Error('Native original open-order set changed'); for (const expected of parent.protectiveOrders) {
        const matches = rows.filter(r => r.orderId === expected.orderId);
        if (matches.length !== 1)
            throw Error('Native original open-order numeric identity changed');
        const actual = matches[0]!;
        for (const key of ['symbol', 'orderId', 'orderListId', 'clientOrderId', 'side', 'type', 'status'])
            if (actual[key] !== expected[key])
                throw Error('Native original open-order receipt mismatch');
        for (const key of ['origQty', 'executedQty', 'stopPrice'])
            if (compareDecimal(exitDecimal(actual[key]), exitDecimal(expected[key])) !== 0)
                throw Error('Native original open-order quantity/trigger changed');
    } }
    private clearTargetOrders(o: ExitObservation, e: Envelope, allowed: string[] = []) {
        if (o.openOrders.some(r => r.symbol === e.symbol.symbol && !allowed.includes(String(r.clientOrderId))))
            throw Error('Unexpected remaining target-symbol order');
    }
    private inventory(o: ExitObservation, e: Envelope, r: Receipt) { return r.sellCommand && !r.sellNotSent ? soldExitInventory(o, e.plan, e.symbol, r.sellCommand, this.now(), this.sellId(r)) : canceledExitInventory(o, e.plan, e.symbol, this.now()); }
    private sellId(r: Receipt) {
        const ack = r.sellAck as {
            orderId?: unknown;
        } | undefined;
        return typeof ack?.orderId === 'number' && Number.isSafeInteger(ack.orderId) ? ack.orderId : undefined;
    }
    private fulfilled(e: Envelope, qty: string) { return compareDecimal(qty, e.plan.predictedRemainingQty) <= 0 || compareDecimal(qty, '0') === 0 || belowNativeQuantity(qty, e.symbol); }
    private close(i: Intent, e: Envelope, r: Receipt, quantity: string, phase = 'exit_closed') { r.remainingQty = quantity; r.actionFulfilled = this.fulfilled(e, quantity); r.reason = phase === 'exit_protected' ? 'Native remainder protected with recorded order/balance proof' : phase === 'exit_closed' ? 'No executable native remainder; any quantity dust remains explicit' : 'Original native protection unchanged'; return this.result(this.save(i, r, phase), r); }
    private blocked(i: Intent, r: Receipt, reason: string) {
        r.reason = reason;
        if (i.state.endsWith('_unknown') || i.state === 'exit_halted_unprotected')
            i = this.save(i, r, i.state);
        return this.result(i, r);
    }
    private halt(i: Intent, r: Receipt, reason: string) { r.reason = reason; r.actionFulfilled = false; return this.result(this.save(i, r, 'exit_halted_unprotected'), r); }
    private quote(o: ExitObservation, e: Envelope) {
        assertExitFresh(o, this.now(), true);
        if (o.book.symbol !== e.plan.pair)
            throw Error('Native exit foreign refreshed depth');
        const b = partialBook(e.plan.pair, { bids: o.book.bids.map(l => [l.price, l.qty]), asks: o.book.asks.map(l => [l.price, l.qty]) }, o.book.receivedAt);
        if (!b.valid || b.symbol !== e.plan.pair)
            throw Error('Native exit invalid refreshed depth');
        const bid = exitDecimal(b.bids[0]!.price, true), ask = exitDecimal(b.asks[0]!.price, true), last = exitDecimal(o.lastTradePrice, true);
        if ((Number(ask) / Number(bid) - 1) * 10000 > e.limits.maxSpreadBps)
            throw Error('Native exit refreshed spread exceeds cap');
        return { b, bid, ask, last };
    }
    private sellCommand(o: ExitObservation, e: Envelope, quantity: string): ExitSellCommand | null {
        const { b, bid } = this.quote(o, e), lot = e.symbol.filters.find(f => f.filterType === 'LOT_SIZE')!, tick = e.symbol.filters.find(f => f.filterType === 'PRICE_FILTER')!.tickSize!, needed = compareDecimal(quantity, e.plan.predictedRemainingQty) > 0 ? subtractDecimal(quantity, e.plan.predictedRemainingQty) : '0', qty = floorStep(needed, lot.stepSize!);
        if (compareDecimal(qty, '0') === 0)
            return null;
        let price = multiplyToStep(bid, subtractDecimal('1', basisPointFraction(e.limits.maxSlippageBps)), tick, true);
        if (compareDecimal(price, e.plan.limitSell.price) < 0)
            price = e.plan.limitSell.price;
        let depth = '0';
        for (const l of b.bids)
            if (compareDecimal(l.price, price) >= 0)
                depth = addDecimal(depth, l.qty);
        if (compareDecimal(price, bid) > 0 || compareDecimal(depth, qty) < 0 || !limitQuantityAllowed(qty, e.symbol) || !limitNotionalAllowed(Number(qty), Number(price), e.symbol))
            return null;
        const after = subtractDecimal(quantity, qty), estimate = multiplyToStep(after, subtractDecimal('1', String(e.limits.feeReservePct)), nativeQuantityStep(e.symbol));
        if (compareDecimal(after, '0') > 0 && !belowNativeQuantity(after, e.symbol) && (!nativeQuantityAllowed(estimate, e.symbol) || !nativeNotionalAllowed(Number(estimate), Number(e.plan.reprotectStopPrice ?? e.plan.oldStopPrice), e.symbol) || !nativeNotionalAllowed(Number(estimate), Number(e.plan.oldTargetPrice), e.symbol)))
            return null;
        assertExitPriceFilter(price, e.symbol);
        return { ...e.plan.limitSell, quantity: qty, price };
    }
    private protectCommand(o: ExitObservation, e: Envelope, quantity: string): ExitProtectCommand {
        const { bid, ask, last } = this.quote(o, e), qty = floorStep(quantity, nativeQuantityStep(e.symbol)), stop = e.plan.reprotectStopPrice ?? e.plan.oldStopPrice, target = e.plan.oldTargetPrice, residual = subtractDecimal(quantity, qty);
        if (compareDecimal(stop, bid) >= 0 || compareDecimal(stop, last) >= 0 || compareDecimal(target, ask) <= 0 || compareDecimal(target, last) <= 0 || !nativeQuantityAllowed(qty, e.symbol) || !nativeNotionalAllowed(Number(qty), Number(stop), e.symbol) || !nativeNotionalAllowed(Number(qty), Number(target), e.symbol) || compareDecimal(residual, '0') > 0 && !belowNativeQuantity(residual, e.symbol))
            throw Error('Native exit remaining quantity cannot be protected without loosening original stop');
        assertExitPriceFilter(stop, e.symbol);
        assertExitPriceFilter(target, e.symbol);
        return { symbol: e.symbol.symbol, side: 'SELL', quantity: qty, listClientOrderId: e.plan.id + '_r', aboveType: 'TAKE_PROFIT', aboveStopPrice: target, aboveClientOrderId: e.plan.id + '_t', belowType: 'STOP_LOSS', belowStopPrice: stop, belowClientOrderId: e.plan.id + '_s', newOrderRespType: 'FULL' };
    }
    private async advance(id: string): Promise<NativeExitResult> {
        for (let step = 0; step < 24; step++) {
            if (this.options.enabled !== true)
                return this.disabled(id);
            let { i, e, r } = this.load(id);
            if (terminal.has(i.state))
                return this.result(i, r);
            // A pending stage after a crash may already have reached the matching engine. Never resubmit.
            if (i.state === 'exit_cancel_pending') {
                i = this.save(i, r, 'exit_cancel_unknown');
            }
            else if (i.state === 'exit_order_pending') {
                i = this.save(i, r, 'exit_order_unknown');
            }
            else if (i.state === 'exit_reprotect_pending') {
                i = this.save(i, r, 'exit_reprotect_unknown');
            }
            let o: ExitObservation;
            try {
                o = await this.transport.observe(e.plan, { sell: r.sellCommand, protect: r.protectCommand });
                assertExitFresh(o, this.now());
                e = { ...e, symbol: currentExitSymbol(o, e.symbol) };
                r.lastObservation = o;
            }
            catch {
                return this.blocked(i, r, 'Native exit observation unavailable or stale; no new mutation');
            }
            if (i.state === 'exit_prepared') {
                try {
                    const parent = parentExitOrders(o, e.plan, false), balance = exitBaseBalance(o, e.symbol);
                    if (parent.terminal) {
                        const inv = canceledExitInventory(o, e.plan, e.symbol, this.now());
                        this.clearTargetOrders(o, e);
                        if (compareDecimal(inv.quantity, '0') === 0 || belowNativeQuantity(inv.quantity, e.symbol))
                            return this.close(i, e, r, inv.quantity);
                        r.remainingQty = inv.quantity;
                        return this.halt(i, r, 'Original native parent already terminal with unprotected remainder; recovery only');
                    }
                    if (parent.protectiveOrders.some(order => order.status !== 'NEW') || compareDecimal(balance.total, e.plan.observedPositionQty) !== 0 || compareDecimal(balance.locked, e.plan.observedProtectedQty) !== 0)
                        throw Error('Native parent/inventory changed before cancellation');
                    this.assertOpenParent(o, e, parent);
                    const quote = this.quote(o, e);
                    if (compareDecimal(e.plan.oldStopPrice, quote.bid) >= 0 || compareDecimal(e.plan.oldStopPrice, quote.last) >= 0 || compareDecimal(e.plan.oldTargetPrice, quote.ask) <= 0 || compareDecimal(e.plan.oldTargetPrice, quote.last) <= 0 || e.plan.reprotectStopPrice && compareDecimal(e.plan.reprotectStopPrice, quote.bid) >= 0)
                        throw Error('Native trigger reached before cancel');
                    this.guard(id, 'exit_prepared', o, true);
                }
                catch {
                    return this.blocked(i, r, 'Native pre-cancel proof changed; no cancellation sent and current protection not confirmed');
                }
                if (e.plan.purpose !== 'tighten' && (this.now() < e.plan.preparedAt || this.now() - e.plan.preparedAt > 30000)) {
                    r.actionFulfilled = false;
                    r.remainingQty = e.plan.observedPositionQty;
                    r.reason = 'Stale model action skipped; original native protection retained';
                    return this.result(this.save(i, r, 'exit_unchanged'), r);
                }
                if (e.plan.purpose === 'tighten' && compareDecimal(e.plan.reprotectStopPrice!, e.plan.oldStopPrice) === 0) {
                    r.actionFulfilled = true;
                    r.remainingQty = e.plan.observedPositionQty;
                    r.reason = 'Requested native stop already active';
                    return this.result(this.save(i, r, 'exit_unchanged'), r);
                }
                try {
                    this.protectCommand(o, e, e.plan.observedPositionQty);
                    if (e.plan.purpose !== 'tighten' && !this.sellCommand(o, e, e.plan.observedPositionQty))
                        throw Error('Current reduction unavailable');
                }
                catch {
                    r.actionFulfilled = false;
                    r.remainingQty = e.plan.observedPositionQty;
                    r.reason = 'Current exit/re-protection filters unavailable; original native protection retained';
                    return this.result(this.save(i, r, 'exit_unchanged'), r);
                }
                i = this.save(i, r, 'exit_cancel_pending');
                let ack: unknown;
                try {
                    let checked = false;
                    ack = await this.transport.cancel(e.plan.cancel, () => { this.guard(id, 'exit_cancel_pending', o, true); checked = true; });
                    if (!checked)
                        throw Error('Native exit transport guard not invoked');
                }
                catch (error) {
                    r.cancelNotSent = error instanceof NativePreSendRejected;
                    i = this.save(i, r, 'exit_cancel_unknown');
                    return this.blocked(i, r, r.cancelNotSent ? 'Native cancellation not sent; verify original protection' : 'Native cancellation outcome unknown; read-only reconciliation required');
                }
                r.cancelAck = ack;
                r.cancelNotSent = false;
                this.save(i, r, 'exit_cancel_unknown');
                continue;
            }
            if (i.state === 'exit_cancel_unknown') {
                if (r.cancelNotSent) {
                    try {
                        const p = parentExitOrders(o, e.plan, false), b = exitBaseBalance(o, e.symbol);
                        if (!p.terminal && p.protectiveOrders.every(order => order.status === 'NEW') && compareDecimal(b.total, e.plan.observedPositionQty) === 0 && compareDecimal(b.locked, e.plan.observedProtectedQty) === 0) {
                            r.remainingQty = b.total;
                            r.actionFulfilled = false;
                            r.reason = 'Native cancel safely not sent; original protection observed';
                            return this.result(this.save(i, r, 'exit_unchanged'), r);
                        }
                        if (p.terminal) {
                            const inv = canceledExitInventory(o, e.plan, e.symbol, this.now());
                            if (compareDecimal(inv.quantity, '0') === 0 || belowNativeQuantity(inv.quantity, e.symbol))
                                return this.close(i, e, r, inv.quantity);
                            this.clearTargetOrders(o, e);
                            r.remainingQty = inv.quantity;
                            return this.halt(i, r, 'Original protection ended despite cancellation not sent; recovery only');
                        }
                    }
                    catch { }
                    return this.blocked(i, r, 'No-send outcome known, current original protection not verified');
                }
                try {
                    canceledExitInventory(o, e.plan, e.symbol, this.now());
                    this.clearTargetOrders(o, e);
                }
                catch {
                    return this.blocked(i, r, 'Native cancel remains unverified; no repeat cancellation/sell');
                }
                this.save(i, r, 'exit_canceled_verified');
                continue;
            }
            if (i.state === 'exit_canceled_verified') {
                let quantity: string;
                try {
                    quantity = canceledExitInventory(o, e.plan, e.symbol, this.now()).quantity;
                    this.clearTargetOrders(o, e);
                }
                catch {
                    return this.halt(i, r, 'Canceled native inventory/fees not verified; unprotected state explicit');
                }
                if (compareDecimal(quantity, '0') === 0 || belowNativeQuantity(quantity, e.symbol))
                    return this.close(i, e, r, quantity);
                let command: ExitSellCommand | null = null;
                try {
                    if (e.plan.purpose !== 'tighten' && this.now() >= e.plan.preparedAt && this.now() - e.plan.preparedAt <= 30000)
                        command = this.sellCommand(o, e, quantity);
                }
                catch { /* Restore protection instead of selling from stale/wide quotes. */ }
                if (!command) {
                    r.remainingQty = quantity;
                    this.save(i, r, 'exit_remaining_verified');
                    continue;
                }
                r.sellCommand = command;
                r.sellNotSent = false;
                i = this.save(i, r, 'exit_order_pending');
                let ack: unknown;
                try {
                    let checked = false;
                    ack = await this.transport.sell(command, () => { this.guard(id, 'exit_order_pending', o, true); checked = true; });
                    if (!checked)
                        throw Error('Native exit transport guard not invoked');
                }
                catch (error) {
                    r.sellNotSent = error instanceof NativePreSendRejected;
                    if (r.sellNotSent) {
                        r.remainingQty = quantity;
                        this.save(i, r, 'exit_remaining_verified');
                        continue;
                    }
                    this.save(i, r, 'exit_order_unknown');
                    return this.blocked(this.journal.get(id)!, r, 'Native FOK outcome unknown; never resubmit');
                }
                r.sellAck = ack;
                this.save(i, r, 'exit_order_unknown');
                continue;
            }
            if (i.state === 'exit_order_unknown') {
                if (!r.sellCommand || !o.sellOrder)
                    return this.blocked(i, r, 'Native FOK order not observed; no replay');
                try {
                    assertExitStandaloneOrder(o.sellOrder, r.sellCommand, this.sellId(r));
                    const inv = soldExitInventory(o, e.plan, e.symbol, r.sellCommand, this.now(), this.sellId(r));
                    this.clearTargetOrders(o, e);
                    r.remainingQty = inv.quantity;
                }
                catch {
                    return this.blocked(i, r, 'Native FOK fills/fees/balances not yet fully verified');
                }
                this.save(i, r, 'exit_remaining_verified');
                continue;
            }
            if (i.state === 'exit_remaining_verified' || i.state === 'exit_halted_unprotected') {
                let quantity: string;
                try {
                    quantity = this.inventory(o, e, r).quantity;
                    this.clearTargetOrders(o, e);
                }
                catch {
                    return i.state === 'exit_halted_unprotected' ? this.blocked(i, r, 'Unprotected native inventory still unverified') : this.halt(i, r, 'Native remaining balance/fees changed; unprotected state explicit');
                }
                if (compareDecimal(quantity, '0') === 0 || belowNativeQuantity(quantity, e.symbol))
                    return this.close(i, e, r, quantity);
                if (i.state === 'exit_halted_unprotected') {
                    if (r.protectCommand && !r.protectNotSent)
                        return this.blocked(i, r, 'Prior protection may have reached exchange; no new mutation');
                    this.save(i, r, 'exit_remaining_verified');
                    continue;
                }
                let command: ExitProtectCommand;
                try {
                    command = this.protectCommand(o, e, quantity);
                    this.guard(id, 'exit_remaining_verified', o, true);
                }
                catch {
                    return this.halt(i, r, 'Native re-protection unavailable at original/tighter stop; no fabricated success');
                }
                r.protectCommand = command;
                r.protectNotSent = false;
                r.remainingQty = quantity;
                i = this.save(i, r, 'exit_reprotect_pending');
                let ack: unknown;
                try {
                    let checked = false;
                    ack = await this.transport.protect(command, () => { this.guard(id, 'exit_reprotect_pending', o, true); checked = true; });
                    if (!checked)
                        throw Error('Native exit transport guard not invoked');
                }
                catch (error) {
                    r.protectNotSent = error instanceof NativePreSendRejected;
                    if (r.protectNotSent)
                        return this.halt(i, r, 'Native re-protection safely not sent; inventory remains explicitly unprotected');
                    this.save(i, r, 'exit_reprotect_unknown');
                    return this.blocked(this.journal.get(id)!, r, 'Native protection outcome unknown; no duplicate list');
                }
                r.protectAck = ack;
                this.save(i, r, 'exit_reprotect_unknown');
                continue;
            }
            if (i.state === 'exit_reprotect_unknown') {
                if (!r.protectCommand || !r.remainingQty)
                    return this.blocked(i, r, 'Native protection contract missing');
                try {
                    const ledger = exitLedgerQuantity(o, e.plan, e.symbol, this.now(), r.sellCommand && !r.sellNotSent ? r.sellCommand : undefined, this.sellId(r));
                    if (compareDecimal(ledger.quantity, r.remainingQty) !== 0)
                        throw Error('Native protection completion lost original fill/fee evidence');
                    const proof = exitProtectionProof(o, r.protectCommand, e.plan, e.symbol, r.remainingQty, this.now(), r.protectAck);
                    r.protectionProof = proof;
                    this.clearTargetOrders(o, e, proof.active ? [r.protectCommand.aboveClientOrderId, r.protectCommand.belowClientOrderId] : []);
                    if (proof.active) {
                        const dust = subtractDecimal(proof.quantity, r.protectCommand.quantity);
                        if (compareDecimal(dust, '0') > 0 && !belowNativeQuantity(dust, e.symbol))
                            throw Error('Executable native remainder not covered');
                        return this.close(i, e, r, proof.quantity, 'exit_protected');
                    }
                    if (proof.closed && (compareDecimal(proof.quantity, '0') === 0 || belowNativeQuantity(proof.quantity, e.symbol)))
                        return this.close(i, e, r, proof.quantity);
                }
                catch { /* A response alone does not prove exchange protection. */ }
                return this.blocked(i, r, 'Native replacement protection/closure not fully confirmed');
            }
            throw Error('Unsupported native exit phase');
        }
        const { i, r } = this.load(id);
        return this.blocked(i, r, 'Native exit bounded-step budget reached; resume from journal');
    }
}
