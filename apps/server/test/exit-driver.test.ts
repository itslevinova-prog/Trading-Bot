import {nativeIntentContext} from '../src/live/intent-context.js';
import {packContext} from '../src/ai/prompt.js';
import {readPackedNativeIntent,readPackedMemoryRecord} from '../src/ai/intent-encoding.js';
import {readPackedRootFeature} from '../src/ai/feature-encoding.js';
import {createHash} from 'node:crypto';
import { BinanceSpotExecutionAdapter, type LiveLimits } from '../src/live/BinanceSpotExecutionAdapter.js';
import {fixtureNativePortfolioEvidence} from './native-policy-fixture.js';
import { resolveNativeBracket, nativeBracketConsumed, nativeExitCompletion, nativeCompletedEntries } from '../src/live/bracket-lineage.js';
import { ownedNativeOrder, stopCoverage } from '../src/live/protection.js';
import { nativePolicyProtection, nativePolicyActivity, nativePolicyLimits, nativeEntryPolicyGuard } from '../src/live/trading-policy.js';
import { effectiveTradingPolicy } from '../src/strategy/trading-policy.js';
import { test, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, realpathSync, rmSync,readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { NativeExitDriver, type NativeExitTransport, type NativeExitJournal } from '../src/live/exit-driver.js';
import { SqliteJournal } from '../src/live/journal.js';
import { NativePreSendRejected, BinanceClient } from '../src/live/BinanceClient.js';
import { addDecimal, subtractDecimal, multiplyToStep, compareDecimal } from '../src/live/decimal.js';
import { prepareOpocoExit } from '../src/live/exit-plan.js';
import type { ExitObservation, ExitSellCommand, ExitProtectCommand, RawOrder } from '../src/live/exit-evidence.js';
const resources: {
    root: string;
    close: () => void;
}[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const r of resources.splice(0)) {
        r.close();
        const root = realpathSync(r.root);
        if (dirname(root) !== realpathSync(tmpdir()) || !basename(root).startsWith('native-exit-driver-'))
            throw Error('Unsafe native exit fixture cleanup');
        rmSync(root, { recursive: true, force: true });
    }
});
function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'native-exit-driver-')), file = join(root, 'journal.db');
    let closed = false, journal = new SqliteJournal(file, 'testnet:EUR:offline-exit');
    resources.push({ root, close: () => {
            if (!closed)
                journal.close();
        } });
    let at = Date.now();
    const parent = 'bot_' + 'a'.repeat(24), symbol = { symbol: 'BTCEUR', baseAsset: 'BTC', quoteAsset: 'EUR', baseAssetPrecision: 8, quoteAssetPrecision: 8, status: 'TRADING', isSpotTradingAllowed: true, ocoAllowed: true, otoAllowed: true, opoAllowed: true, orderTypes: ['LIMIT', 'STOP_LOSS', 'TAKE_PROFIT'], filters: [{ filterType: 'LOT_SIZE', minQty: '.00001', maxQty: '100', stepSize: '.00001' }, { filterType: 'MARKET_LOT_SIZE', minQty: '.00001', maxQty: '100', stepSize: '.00001' }, { filterType: 'PRICE_FILTER', tickSize: '.01', minPrice: '.01', maxPrice: '1000000' }, { filterType: 'NOTIONAL', minNotional: '5' }] }, payload = { symbol: symbol.symbol, listClientOrderId: parent, workingClientOrderId: parent + '_e', workingType: 'LIMIT', workingSide: 'BUY', workingTimeInForce: 'FOK', workingPrice: '100', workingQuantity: '1', pendingSide: 'SELL', pendingBelowClientOrderId: parent + '_s', pendingBelowType: 'STOP_LOSS', pendingBelowStopPrice: '95', pendingAboveClientOrderId: parent + '_t', pendingAboveType: 'TAKE_PROFIT', pendingAboveStopPrice: '110' };
    let parentOrders: RawOrder[] = [{ symbol: symbol.symbol, orderId: 1, orderListId: 42, clientOrderId: parent + '_e', side: 'BUY', type: 'LIMIT', timeInForce: 'FOK', price: '100', origQty: '1', executedQty: '1', cummulativeQuoteQty: '100', status: 'FILLED' }, ...['_s', '_t'].map((suffix, i) => ({ symbol: symbol.symbol, orderId: i + 2, orderListId: 42, clientOrderId: parent + suffix, side: 'SELL', type: i ? 'TAKE_PROFIT' : 'STOP_LOSS', origQty: '1', executedQty: '0', cummulativeQuoteQty: '0', stopPrice: i ? '110' : '95', status: 'NEW' }))];
    let originalList = { symbol: symbol.symbol, orderListId: 42, listClientOrderId: parent, listStatusType: 'EXEC_STARTED', listOrderStatus: 'EXECUTING', orders: parentOrders.map(r => ({ symbol: r.symbol, orderId: r.orderId, clientOrderId: r.clientOrderId })) };
    journal.put({ id: parent, pair: 'BTC/EUR', side: 'buy', state: 'pending', createdAt: at - 1000, payload: JSON.stringify(payload), result: '' });
    journal.update(parent, 'accepted', JSON.stringify(originalList));
    const c = { quote: '900', base: '1', locked: '1', bid: '100', ask: '100.01', last: '100', cancelled: false, cancelId: parent, cancelFill: '0', cancelBaseFee: '0', sellBaseFee: '0', sellMode: 'filled' as 'filled' | 'expired' | 'pending', protectFill: false, loseCancel: false, loseSell: false, loseProtect: false, aliasIds: false, hideTrades: false, failObserve: 0, advanceCancelGuard: 0, advanceSellGuard: 0, advanceProtectGuard: 0, afterCancel: () => { }, afterSell: () => { } };
    const effects: string[] = [], trades: Record<string, unknown[]> = {};
    let nextOrderId = 4, nextListId = 43;
    let sell: RawOrder | null = null, protectCommand: ExitProtectCommand | undefined, protectionList: RawOrder | undefined, protectionOrders: RawOrder[] = [];
    const balance = () => ({ canTrade: true, balances: [{ asset: 'EUR', free: c.quote, locked: '0' }, { asset: 'BTC', free: subtractDecimal(c.base, c.locked), locked: c.locked }] }), book = () => ({ symbol: 'BTC/EUR', valid: true, receivedAt: at, bids: [{ price: c.bid, qty: '10' }], asks: [{ price: c.ask, qty: '10' }] });
    const fill = (order: RawOrder, quantity: string, baseFee = '0') => {
        order.executedQty = quantity;
        order.cummulativeQuoteQty = multiplyToStep(quantity, '100', '.00000001');
        if (compareDecimal(quantity, '0') > 0) {
            trades[String(order.orderId)] = [{ symbol: symbol.symbol, id: 100 + Number(order.orderId), orderId: order.orderId, orderListId: order.orderListId, price: '100', qty: quantity, quoteQty: order.cummulativeQuoteQty, commission: baseFee, commissionAsset: 'BTC', time: at, isBuyer: order.side === 'BUY', isMaker: false }];
            c.base = subtractDecimal(c.base, addDecimal(quantity, baseFee));
            c.quote = addDecimal(c.quote, String(order.cummulativeQuoteQty));
        }
    };
    const check = (guard: () => void, advance: number) => {
        at += advance;
        try {
            guard();
        }
        catch {
            throw new NativePreSendRejected();
        }
    };
    const transport: NativeExitTransport = {
        observe: vi.fn(async () => {
            if (c.failObserve-- > 0)
                throw Error('fixture-private-provider-message');
            at += 1;
            const o: ExitObservation = { asOf: at, completedAt: at, account: balance(), openOrders: c.cancelled ? protectionOrders.filter(r => r.status === 'NEW') : parentOrders.filter(r => r.side === 'SELL'), parentList: { ...originalList, listClientOrderId: c.cancelId, listStatusType: c.cancelled ? 'ALL_DONE' : 'EXEC_STARTED', listOrderStatus: c.cancelled ? 'ALL_DONE' : 'EXECUTING', orders: parentOrders.map(r => ({ symbol: r.symbol, orderId: r.orderId, clientOrderId: r.clientOrderId })) }, parentOrders, book: book(), lastTradePrice: c.last, lastTradeAsOf: at, symbol, symbolAsOf: at, trades: c.hideTrades ? {} : trades, sellOrder: sell, protectionList, protectionOrders };
            return JSON.parse(JSON.stringify(o));
        }),
        cancel: vi.fn(async (command, guard) => {
            expect(journal.get(command.newClientOrderId.slice(0, -2))!.state).toBe('exit_cancel_pending');
            check(guard, c.advanceCancelGuard);
            effects.push('cancel');
            c.cancelled = true;
            c.cancelId = c.aliasIds ? command.newClientOrderId : originalList.listClientOrderId;
            const [stop, target] = parentOrders.filter(r => r.side === 'SELL');
            stop!.status = target!.status = 'CANCELED';
            if (c.aliasIds) {
                stop!.clientOrderId = 'changed-stop-id';
                target!.clientOrderId = 'changed-target-id';
            }
            c.locked = '0';
            if (compareDecimal(c.cancelFill, '0') > 0)
                fill(stop!, c.cancelFill, c.cancelBaseFee);
            c.afterCancel();
            if (c.loseCancel)
                throw Error('fixture-private-cancel-response');
            return { symbol: symbol.symbol, orderListId: originalList.orderListId, listClientOrderId: c.cancelId };
        }),
        sell: vi.fn(async (command, guard) => {
            expect(journal.unresolved()).toHaveLength(1);
            check(guard, c.advanceSellGuard);
            effects.push('sell');
            sell = { symbol: symbol.symbol, orderId: nextOrderId++, orderListId: -1, clientOrderId: command.newClientOrderId, side: 'SELL', type: 'LIMIT', timeInForce: 'FOK', price: command.price, origQty: command.quantity, executedQty: '0', cummulativeQuoteQty: '0', status: c.sellMode === 'expired' ? 'EXPIRED' : c.sellMode === 'pending' ? 'NEW' : 'FILLED' };
            if (c.sellMode === 'filled')
                fill(sell, command.quantity, c.sellBaseFee);
            if (c.sellMode === 'pending')
                c.locked = command.quantity;
            c.afterSell();
            if (c.loseSell)
                throw Error('fixture-private-sell-response');
            return structuredClone(sell);
        }),
        protect: vi.fn(async (command, guard) => {
            expect(journal.unresolved()).toHaveLength(1);
            check(guard, c.advanceProtectGuard);
            effects.push('protect');
            protectCommand = command;
            const listId = nextListId++;
            c.locked = command.quantity;
            protectionOrders = [{ symbol: symbol.symbol, orderId: nextOrderId++, orderListId: listId, clientOrderId: command.belowClientOrderId, side: 'SELL', type: 'STOP_LOSS', stopPrice: command.belowStopPrice, origQty: command.quantity, executedQty: '0', cummulativeQuoteQty: '0', status: 'NEW' }, { symbol: symbol.symbol, orderId: nextOrderId++, orderListId: listId, clientOrderId: command.aboveClientOrderId, side: 'SELL', type: 'TAKE_PROFIT', stopPrice: command.aboveStopPrice, origQty: command.quantity, executedQty: '0', cummulativeQuoteQty: '0', status: 'NEW' }];
            protectionList = { symbol: symbol.symbol, orderListId: listId, listClientOrderId: command.listClientOrderId, listStatusType: 'EXEC_STARTED', listOrderStatus: 'EXECUTING', orders: protectionOrders.map(r => ({ symbol: r.symbol, orderId: r.orderId, clientOrderId: r.clientOrderId })) };
            if (c.protectFill) {
                fill(protectionOrders[0]!, command.quantity);
                protectionOrders[0]!.status = 'FILLED';
                protectionOrders[1]!.status = 'CANCELED';
                c.locked = '0';
                protectionList.listStatusType = protectionList.listOrderStatus = 'ALL_DONE';
            }
            if (c.loseProtect)
                throw Error('fixture-private-protection-response');
            return structuredClone(protectionList);
        })
    };
    const input: Parameters<typeof prepareOpocoExit>[0] = { action: { type: 'sell', pair: 'BTC/EUR', sellFraction: .5, confidence: 1, reasoning: 'offline fixture' }, decisionId: 'exit-fixture', now: at, account: { ...balance(), cash: 900, equity: 1000, positions: [{ pair: 'BTC/EUR', qty: 1, qtyText: '1', value: 100, bid: 100, priceAsOf: at, nativeQuantityDust: false }], valuationMethod: 'offline fixture', asOf: at, snapshotCompletedAt: at }, symbols: [symbol], openOrders: parentOrders.filter(r => r.side === 'SELL') as any, parentList: structuredClone(originalList), parentOrders: structuredClone(parentOrders), ordersAsOf: at, parentReceiptsAsOf: at, book: book(), journal, limits: { quote: 'EUR', feeReservePct: .005, maxSpreadBps: 20, maxSlippageBps: 10 } };
    let driver = new NativeExitDriver(journal, transport, { enabled: true, now: () => at });
    return { root, file, input, c, transport, effects, trades, symbol, get parentOrders() { return parentOrders; }, now: () => at, advance(ms: number) { at += ms; }, followReplacement(decisionId: string, sellFraction = .5) {
            if (!protectionList || protectionOrders.length !== 2)
                throw Error('No replacement to follow');
            parentOrders = structuredClone(protectionOrders);
            originalList = structuredClone(protectionList) as typeof originalList;
            c.cancelled = false;
            c.cancelId = originalList.listClientOrderId;
            protectionList = undefined;
            protectionOrders = [];
            sell = null;
            c.loseCancel = c.loseSell = c.loseProtect = false;
            c.cancelFill = c.cancelBaseFee = c.sellBaseFee = '0';
            const qty = Number(c.base), bid = Number(c.bid);
            return { ...input, decisionId, action: { ...input.action, sellFraction }, now: at, journal, account: { ...input.account, ...balance(), cash: Number(c.quote), equity: Number(c.quote) + qty * bid, positions: [{ pair: 'BTC/EUR', qty, qtyText: c.base, value: qty * bid, bid, priceAsOf: at, nativeQuantityDust: false }], asOf: at, snapshotCompletedAt: at }, openOrders: structuredClone(parentOrders) as any, parentList: structuredClone(originalList), parentOrders: structuredClone(parentOrders), ordersAsOf: at, parentReceiptsAsOf: at, book: book() };
        }, get journal() { return journal; }, get driver() { return driver; }, get sell() { return sell; }, get protectCommand() { return protectCommand; }, get protectionOrders() { return protectionOrders; }, get protectionList() { return protectionList; }, reopen() { journal.close(); closed = true; journal = new SqliteJournal(file, 'testnet:EUR:offline-exit'); closed = false; driver = new NativeExitDriver(journal, transport, { enabled: true, now: () => at }); }, finishSell() {
            if (!sell)
                throw Error('No pending fixture sale');
            c.locked = '0';
            sell.status = 'FILLED';
            fill(sell, String(sell.origQty), c.sellBaseFee);
        } };
}
test('native partial exit cancels once, sells the absolute target, and confirms actual remainder protection', async () => { const f = fixture(), r = await f.driver.start(f.input); expect(r).toMatchObject({ phase: 'exit_protected', protected: true, actionFulfilled: true, remainingQty: '0.50000' }); expect(f.effects).toEqual(['cancel', 'sell', 'protect']); expect(f.protectCommand?.quantity).toBe('0.50000'); expect(f.protectCommand?.belowStopPrice).toBe('95'); expect(f.journal.unresolved()).toHaveLength(0); expect(f.journal.audit(r.id).recordedFromOrigin).toBe(true); });
test('native full exit has no invented reprotection or remaining balance', async () => { const f = fixture(); f.input.action.sellFraction = 1; const r = await f.driver.start(f.input); expect(r).toMatchObject({ phase: 'exit_closed', remainingQty: '0.00000', actionFulfilled: true }); expect(f.effects).toEqual(['cancel', 'sell']); });
test('base commission after sale reduces actual remainder exactly and is not reserved again', async () => { const f = fixture(); f.c.sellBaseFee = '.0005'; const r = await f.driver.start(f.input); expect(r.remainingQty).toBe('0.49950'); expect(f.protectCommand?.quantity).toBe('0.49950'); expect(JSON.parse(f.journal.get(r.id)!.result).lastObservation.trades['4'][0].commission).toBe('.0005'); });
test('native stop fill during cancel is subtracted from the original target instead of applying fraction twice', async () => { const f = fixture(); f.c.cancelFill = '.4'; f.c.cancelBaseFee = '.0004'; const r = await f.driver.start(f.input); expect(r.phase).toBe('exit_protected'); expect(f.sell?.origQty).toBe('0.09960'); expect(r.remainingQty).toBe('0.50000'); });
test('complete native fill during cancel never triggers a duplicate model sell', async () => { const f = fixture(); f.c.cancelFill = '1'; const r = await f.driver.start(f.input); expect(r).toMatchObject({ phase: 'exit_closed', remainingQty: '0' }); expect(f.effects).toEqual(['cancel']); });
test('changed cancellation client IDs stay bound to their original numeric order IDs', async () => { const f = fixture(); f.c.aliasIds = true; const r = await f.driver.start(f.input); expect(r.phase).toBe('exit_protected'); expect(f.parentOrders[1]!.clientOrderId).toBe('changed-stop-id'); });
test.each(['cancel', 'sell', 'protect'])('lost %s response recovers read-only after SQLite reopen without resubmission', async (stage) => {
    const f = fixture();
    if (stage === 'cancel')
        f.c.loseCancel = true;
    if (stage === 'sell')
        f.c.loseSell = true;
    if (stage === 'protect')
        f.c.loseProtect = true;
    const first = await f.driver.start(f.input);
    expect(first.phase).toContain('unknown');
    f.reopen();
    const r = await f.driver.resume(first.id);
    expect(r.phase).toBe('exit_protected');
    expect(f.effects.filter(x => x === stage)).toHaveLength(1);
    expect(f.journal.get(first.id)!.result).not.toContain('fixture-private-');
});
test('a never observed cancel stays unknown and is never repeated, even when old bracket still appears open', async () => {
    const f = fixture(), transition = f.journal.transition.bind(f.journal);
    vi.spyOn(f.journal, 'transition').mockImplementation((id, from, to, result) => {
        transition(id, from, to, result);
        if (to === 'exit_cancel_pending')
            throw Error('simulated crash after commit before network');
    });
    await expect(f.driver.start(f.input)).rejects.toThrow('simulated crash');
    const id = f.journal.unresolved()[0]!.id;
    f.reopen();
    const r = await f.driver.resume(id);
    expect(r.phase).toBe('exit_cancel_unknown');
    expect(r.protected).toBe(false);
    expect(f.effects).toHaveLength(0);
});
test('lost durable cancel acknowledgement never turns into a second cancellation', async () => {
    const f = fixture(), transition = f.journal.transition.bind(f.journal);
    let fail = true;
    vi.spyOn(f.journal, 'transition').mockImplementation((id, from, to, result) => {
        if (to === 'exit_cancel_unknown' && fail) {
            fail = false;
            throw Error('receipt write failed');
        }
        transition(id, from, to, result);
    });
    await expect(f.driver.start(f.input)).rejects.toThrow('receipt write');
    const id = f.journal.unresolved()[0]!.id;
    f.reopen();
    const r = await f.driver.resume(id);
    expect(r.phase).toBe('exit_protected');
    expect(f.effects.filter(x => x === 'cancel')).toHaveLength(1);
});
test('FOK expire restores all observed inventory but never claims the model reduction executed', async () => { const f = fixture(); f.c.sellMode = 'expired'; const r = await f.driver.start(f.input); expect(r).toMatchObject({ phase: 'exit_protected', actionFulfilled: false, remainingQty: '1' }); expect(f.protectCommand?.quantity).toBe('1.00000'); });
test('an unresolved FOK cannot be replayed or protected over an active pending sell', async () => { const f = fixture(); f.c.sellMode = 'pending'; const first = await f.driver.start(f.input); expect(first.phase).toBe('exit_order_unknown'); expect(f.effects).toEqual(['cancel', 'sell']); f.reopen(); expect((await f.driver.resume(first.id)).phase).toBe('exit_order_unknown'); f.finishSell(); expect((await f.driver.resume(first.id)).phase).toBe('exit_protected'); expect(f.effects.filter(x => x === 'sell')).toHaveLength(1); });
test('missing fills stay unknown and recover only when the actual quantity/fee proof appears', async () => { const f = fixture(); f.c.afterSell = () => { f.c.hideTrades = true; }; const first = await f.driver.start(f.input); expect(first.phase).toBe('exit_order_unknown'); expect(f.effects).toEqual(['cancel', 'sell']); f.c.hideTrades = false; expect((await f.driver.resume(first.id)).phase).toBe('exit_protected'); expect(f.effects.filter(x => x === 'sell')).toHaveLength(1); });
test('price gap after cancel is explicit unprotected halt; rebound recovery restores without an old model sale', async () => { const f = fixture(); f.c.afterCancel = () => { f.c.bid = '94'; f.c.ask = '94.01'; f.c.last = '94'; }; const first = await f.driver.start(f.input); expect(first).toMatchObject({ phase: 'exit_halted_unprotected', protected: false, actionFulfilled: false }); expect(f.effects).toEqual(['cancel']); f.c.bid = '100'; f.c.ask = '100.01'; f.c.last = '100'; f.reopen(); const r = await f.driver.resume(first.id); expect(r).toMatchObject({ phase: 'exit_protected', actionFulfilled: false, remainingQty: '1' }); expect(f.effects).toEqual(['cancel', 'protect']); });
test('tightening replaces the original stop with no model sale; an equal stop is a no-op', async () => { const f = fixture(), r = await f.driver.tighten(f.input, '97'); expect(r).toMatchObject({ phase: 'exit_protected', actionFulfilled: true, remainingQty: '1' }); expect(f.effects).toEqual(['cancel', 'protect']); expect(f.protectCommand?.belowStopPrice).toBe('97'); const g = fixture(), same = await g.driver.tighten(g.input, '95'); expect(same).toMatchObject({ phase: 'exit_unchanged', actionFulfilled: true }); expect(g.effects).toHaveLength(0); });
test('disabled driver never reserves, reads or mutates the native account', async () => { const f = fixture(), d = new NativeExitDriver(f.journal, f.transport, { enabled: false, now: f.now }); expect((await d.start(f.input)).phase).toBe('disabled'); expect(f.transport.observe).not.toHaveBeenCalled(); expect(f.journal.unresolved()).toHaveLength(0); });
test('duplicate same action returns durable outcome; contradictory fraction is refused without another effect', async () => { const f = fixture(), [a, b] = await Promise.all([f.driver.start(f.input), f.driver.start(f.input)]); expect(a).toEqual(b); expect(f.effects).toEqual(['cancel', 'sell', 'protect']); await expect(f.driver.start({ ...f.input, action: { ...f.input.action, sellFraction: 1 } })).rejects.toThrow('Contradictory'); });
test('last guard after a slow cancel commit prevents network cancellation and verifies original protection on resume', async () => { const f = fixture(); f.c.advanceCancelGuard = 2501; const first = await f.driver.start(f.input); expect(first.phase).toBe('exit_cancel_unknown'); expect(f.effects).toHaveLength(0); const r = await f.driver.resume(first.id); expect(r).toMatchObject({ phase: 'exit_unchanged', protected: true, actionFulfilled: false }); });
test('a new OCO can fill immediately; verified resulting closure stays distinct from active protection', async () => { const f = fixture(); f.c.protectFill = true; const r = await f.driver.start(f.input); expect(r).toMatchObject({ phase: 'exit_closed', remainingQty: '0.00000' }); expect(f.effects).toEqual(['cancel', 'sell', 'protect']); });
test('original parent cannot be consumed twice under a new decision after replacement', async () => { const f = fixture(), second = { ...f.input, decisionId: 'another-decision', openOrders: structuredClone(f.input.openOrders) }; await f.driver.start(f.input); await expect(f.driver.start(second)).rejects.toThrow(); expect(f.effects).toEqual(['cancel', 'sell', 'protect']); expect(f.journal.unresolved()).toHaveLength(0); });
test('refreshed trigger or selected new stop crossing leaves original protection intact', async () => {
    for (const tightening of [false, true]) {
        const f = fixture();
        f.c.bid = tightening ? '96' : '94';
        f.c.ask = tightening ? '96.01' : '94.01';
        f.c.last = f.c.bid;
        const r = tightening ? await f.driver.tighten(f.input, '97') : await f.driver.start(f.input);
        expect(r.phase).toBe('exit_prepared');
        expect(f.effects).toHaveLength(0);
    }
});
test('journal reservation failure prevents every transport read and mutation', async () => { const f = fixture(); vi.spyOn(f.journal, 'reserveExit').mockImplementation(() => { throw Error('reservation unavailable'); }); await expect(f.driver.start(f.input)).rejects.toThrow('reservation'); expect(f.transport.observe).not.toHaveBeenCalled(); expect(f.effects).toHaveLength(0); });
test('different connections cannot reserve two unresolved exits in the same journal', () => {
    const f = fixture(), plan = prepareOpocoExit(f.input), other = new SqliteJournal(f.file, 'testnet:EUR:offline-exit');
    try {
        f.journal.reserveExit({ id: plan.id, pair: plan.pair, side: 'sell', state: 'exit_prepared', createdAt: f.now(), payload: '{}', result: '{}' });
        expect(() => other.reserveExit({ id: 'bot_' + 'b'.repeat(24), pair: plan.pair, side: 'sell', state: 'exit_prepared', createdAt: f.now(), payload: '{}', result: '{}' })).toThrow('unresolved');
        expect(other.unresolved()).toHaveLength(1);
    }
    finally {
        other.close();
    }
});
test('foreign or duplicate cancel child IDs never authorize a model sell', async () => { const f = fixture(); f.c.loseCancel = true; const first = await f.driver.start(f.input); f.parentOrders[1]!.orderId = 999; const r = await f.driver.resume(first.id); expect(r.phase).toBe('exit_cancel_unknown'); expect(f.effects).toEqual(['cancel']); });
test('changed quantities or untracked base deposits are not treated as owned free inventory', async () => { const f = fixture(); f.c.afterCancel = () => { f.c.base = '1.1'; }; const r = await f.driver.start(f.input); expect(r.phase).toBe('exit_cancel_unknown'); expect(f.effects).toEqual(['cancel']); });
test('missing, duplicate or foreign commission trades block later mutations', async () => {
    for (const change of ['missing', 'duplicate', 'foreign'] as const) {
        const f = fixture();
        f.c.sellBaseFee = '.0005';
        f.c.afterSell = () => {
            const rows = f.trades['4']!;
            if (change === 'missing')
                f.trades['4'] = [];
            if (change === 'duplicate')
                rows.push(structuredClone(rows[0]));
            if (change === 'foreign')
                (rows[0] as any).orderId = 999;
        };
        const r = await f.driver.start(f.input);
        expect(r.phase).toBe('exit_order_unknown');
        expect(f.effects).toEqual(['cancel', 'sell']);
    }
});
test('unconfirmed OCO receipt never becomes protected based on POST acknowledgement alone', async () => { const f = fixture(); f.c.loseProtect = true; const first = await f.driver.start(f.input); f.protectionOrders[0]!.orderListId = 999; const r = await f.driver.resume(first.id); expect(r).toMatchObject({ phase: 'exit_reprotect_unknown', protected: false }); expect(f.effects.filter(x => x === 'protect')).toHaveLength(1); });
test('current symbol filters can block a replacement instead of reusing stale preflight minima', async () => { const f = fixture(); f.c.afterCancel = () => { f.symbol.filters.find(x => x.filterType === 'NOTIONAL')!.minNotional = '200'; }; const r = await f.driver.start(f.input); expect(r.phase).toBe('exit_halted_unprotected'); expect(f.effects).toEqual(['cancel']); });
test('a never sent FOK restores the whole actual position without retrying a sale', async () => { const f = fixture(); f.c.advanceSellGuard = 2501; const r = await f.driver.start(f.input); expect(r).toMatchObject({ phase: 'exit_protected', actionFulfilled: false, remainingQty: '1' }); expect(f.effects).toEqual(['cancel', 'protect']); });
test('a never sent protection attempt remains unprotected until a fresh bounded recovery succeeds', async () => { const f = fixture(); f.c.advanceProtectGuard = 2501; const first = await f.driver.start(f.input); expect(first.phase).toBe('exit_halted_unprotected'); expect(f.effects).toEqual(['cancel', 'sell']); f.c.advanceProtectGuard = 0; const r = await f.driver.resume(first.id); expect(r.phase).toBe('exit_protected'); expect(f.effects).toEqual(['cancel', 'sell', 'protect']); });
test('foreign depth or changed symbol identity cannot cancel the original native bracket', async () => {
    for (const foreign of ['book', 'symbol']) {
        const f = fixture(), observe = f.transport.observe;
        vi.spyOn(f.transport, 'observe').mockImplementation(async (...args) => {
            const o = await observe(...args);
            if (foreign === 'book')
                o.book.symbol = 'ETH/EUR';
            else
                o.symbol.baseAsset = 'ETH';
            return o;
        });
        const r = await f.driver.start(f.input);
        expect(r.phase).toBe('exit_prepared');
        expect(f.effects).toHaveLength(0);
    }
});
test('replacement price limits are freshly checked even when the original target was valid at preflight', async () => { const f = fixture(); f.c.afterCancel = () => { f.symbol.filters.find(x => x.filterType === 'PRICE_FILTER')!.maxPrice = '105'; }; const r = await f.driver.start(f.input); expect(r.phase).toBe('exit_halted_unprotected'); expect(f.effects).toEqual(['cancel', 'sell']); });
test('protection POST and later numeric list identities must not contradict each other', async () => {
    const f = fixture(), observe = f.transport.observe;
    vi.spyOn(f.transport, 'observe').mockImplementation(async (...args) => {
        const o = await observe(...args);
        if (o.protectionList) {
            (o.protectionList as any).orderListId = 44;
            for (const r of o.protectionOrders ?? [])
                r.orderListId = 44;
            for (const r of o.openOrders)
                r.orderListId = 44;
        }
        return o;
    });
    const r = await f.driver.start(f.input);
    expect(r).toMatchObject({ phase: 'exit_reprotect_unknown', protected: false });
    expect(f.effects.filter(x => x === 'protect')).toHaveLength(1);
});
test.each(['cancel', 'sell', 'protect'] as const)('crash after %s pending commit is recovered through reads without replaying the pending effect', async (stage) => {
    const f = fixture(), phase = stage === 'cancel' ? 'exit_cancel_pending' : stage === 'sell' ? 'exit_order_pending' : 'exit_reprotect_pending', transition = f.journal.transition.bind(f.journal);
    vi.spyOn(f.journal, 'transition').mockImplementation((id, from, to, result) => {
        transition(id, from, to, result);
        if (to === phase)
            throw Error('crash after pending commit');
    });
    await expect(f.driver.start(f.input)).rejects.toThrow('crash after pending');
    const id = f.journal.unresolved()[0]!.id, prior = [...f.effects];
    f.reopen();
    const r = await f.driver.resume(id);
    expect(r.phase).toBe(stage === 'cancel' ? 'exit_cancel_unknown' : stage === 'sell' ? 'exit_order_unknown' : 'exit_reprotect_unknown');
    expect(f.effects).toEqual(prior);
    expect(f.effects).not.toContain(stage);
});
test.each(['cancel', 'sell', 'protect'] as const)('failed durable %s preparation never reaches that network mutation', async (stage) => {
    const f = fixture(), phase = stage === 'cancel' ? 'exit_cancel_pending' : stage === 'sell' ? 'exit_order_pending' : 'exit_reprotect_pending', transition = f.journal.transition.bind(f.journal);
    vi.spyOn(f.journal, 'transition').mockImplementation((id, from, to, result) => {
        if (to === phase)
            throw Error('commit refused');
        transition(id, from, to, result);
    });
    await expect(f.driver.start(f.input)).rejects.toThrow('commit refused');
    expect(f.effects).not.toContain(stage);
    expect(f.journal.unresolved()).toHaveLength(1);
});
test('two driver instances sharing one SQLite journal submit each mutation at most once', async () => {
    const f = fixture(), other = new SqliteJournal(f.file, 'testnet:EUR:offline-exit'), second = new NativeExitDriver(other, f.transport, { enabled: true, now: f.now });
    try {
        const settled = await Promise.allSettled([f.driver.start(f.input), second.start(f.input)]);
        expect(settled.some(r => r.status === 'fulfilled')).toBe(true);
        for (const effect of ['cancel', 'sell', 'protect'])
            expect(f.effects.filter(x => x === effect).length).toBeLessThanOrEqual(1);
        const existing = f.journal.recent(0).find(i => i.side === 'sell')!;
        await f.driver.resume(existing.id);
        for (const effect of ['cancel', 'sell', 'protect'])
            expect(f.effects.filter(x => x === effect).length).toBeLessThanOrEqual(1);
    }
    finally {
        other.close();
    }
});
test('undefined tighten stop cannot fall through into a model SELL operation', async () => { const f = fixture(); await expect(f.driver.tighten(f.input, undefined as any)).rejects.toThrow(); expect(f.effects).toHaveLength(0); expect(f.journal.unresolved()).toHaveLength(0); });
test('disabled resume and a truthy non-boolean enable value never reach private transport', async () => {
    const f = fixture();
    for (const enabled of [false, 'false' as any]) {
        const driver = new NativeExitDriver(f.journal, f.transport, { enabled, now: f.now });
        expect((await driver.start(f.input)).phase).toBe('disabled');
        expect((await driver.resume('anything')).phase).toBe('disabled');
    }
    expect(f.transport.observe).not.toHaveBeenCalled();
    expect(f.effects).toHaveLength(0);
});
test('stale preflight is rejected before reservation or transport', async () => { const f = fixture(); f.advance(5001); await expect(f.driver.start(f.input)).rejects.toThrow('clock stale'); expect(f.journal.unresolved()).toHaveLength(0); expect(f.transport.observe).not.toHaveBeenCalled(); });
test('old model reduction after a lost cancel response restores current protection without executing the old sale', async () => { const f = fixture(); f.c.loseCancel = true; const first = await f.driver.start(f.input); f.advance(30001); f.reopen(); const r = await f.driver.resume(first.id); expect(r).toMatchObject({ phase: 'exit_protected', actionFulfilled: false, remainingQty: '1' }); expect(f.effects).toEqual(['cancel', 'protect']); });
test('unprotectable quantity dust remains explicit and is not falsely described as protected', async () => { const f = fixture(); f.c.cancelFill = '.999995'; const r = await f.driver.start(f.input); expect(r).toMatchObject({ phase: 'exit_closed', protected: false, remainingQty: '0.000005' }); expect(f.effects).toEqual(['cancel']); expect(f.c.base).toBe('0.000005'); });
test('substep base fee leaves exact accounted dust beside the confirmed protective order', async () => { const f = fixture(); f.c.sellBaseFee = '.00000001'; const r = await f.driver.start(f.input); expect(r).toMatchObject({ phase: 'exit_protected', remainingQty: '0.49999999' }); expect(compareDecimal(f.protectCommand!.quantity, '0.49999')).toBe(0); const receipt = JSON.parse(f.journal.get(r.id)!.result); expect(receipt.protectionProof.balance.free).toBe('0.00000999'); });
test('a parent becoming terminal before local cancel with a positive remainder is explicitly unprotected and recovers without a model sale', async () => {
    const f = fixture(), observe = f.transport.observe;
    let first = true;
    vi.spyOn(f.transport, 'observe').mockImplementation(async (...args) => {
        if (first) {
            first = false;
            f.c.cancelled = true;
            f.c.locked = '0';
            f.parentOrders[1]!.status = f.parentOrders[2]!.status = 'CANCELED';
        }
        return observe(...args);
    });
    const firstResult = await f.driver.start(f.input);
    expect(firstResult).toMatchObject({ phase: 'exit_halted_unprotected', protected: false, remainingQty: '1' });
    expect(f.effects).toHaveLength(0);
    const r = await f.driver.resume(firstResult.id);
    expect(r).toMatchObject({ phase: 'exit_protected', actionFulfilled: false });
    expect(f.effects).toEqual(['protect']);
});
test('changed filters before cancel retain the active old bracket when an expired FOK could not be re-protected', async () => { const f = fixture(), observe = f.transport.observe; vi.spyOn(f.transport, 'observe').mockImplementation(async (...args) => { const o = await observe(...args); o.symbol.filters.find(x => x.filterType === 'NOTIONAL')!.minNotional = '150'; return o; }); const r = await f.driver.start(f.input); expect(r).toMatchObject({ phase: 'exit_unchanged', protected: true, actionFulfilled: false }); expect(f.effects).toHaveLength(0); });
const policyHard = { MAX_POSITION_PCT: .3, MAX_OPEN_POSITIONS: 4, MAX_TRADES_PER_DAY: 10, COIN_COOLDOWN_MINUTES: 60, MAX_TOTAL_RISK_PCT: .025, MAX_ENTRY_SPREAD_BPS: 20, MAX_ENTRY_SLIPPAGE_BPS: 30, DEFAULT_STOP_LOSS_PCT: .05 };
test('verified replacement owns exact numeric children and resolves to the original entry', async () => {
    const f = fixture(), first = await f.driver.start(f.input), lineage = resolveNativeBracket(first.id, f.journal, f.now());
    expect(lineage).toMatchObject({ depth: 1, entryOrderId: 1, remainingQty: '0.50000' });
    expect(lineage.root.id).toBe(f.input.openOrders[0]!.clientOrderId.slice(0, -2));
    expect(lineage.contract.listClientOrderId).toBe(first.id + '_r');
    for (const order of f.protectionOrders)
        expect(ownedNativeOrder(order as any, f.journal, f.now())).toBe(true);
    expect(nativeBracketConsumed(lineage.root.id, f.journal)).toBe(true);
    expect(ownedNativeOrder({ ...f.input.openOrders[0]!, status: 'NEW' }, f.journal, f.now())).toBe(false);
    expect(ownedNativeOrder({ ...f.protectionOrders[0]!, orderId: 999 } as any, f.journal, f.now())).toBe(false);
});
test('two partial exits followed by a full exit keep original entry and replace only the current OCO', async () => { const f = fixture(), first = await f.driver.start(f.input), secondInput = f.followReplacement('second-exit'), second = await f.driver.start(secondInput); expect(second).toMatchObject({ phase: 'exit_protected', remainingQty: '0.25000' }); const secondPlan = JSON.parse(f.journal.get(second.id)!.payload).plan; expect(secondPlan).toMatchObject({ parentKind: 'oco', parentId: first.id, parentClientOrderId: first.id + '_r', entryOrderId: 1, ancestryDepth: 1 }); expect(resolveNativeBracket(second.id, f.journal, f.now()).depth).toBe(2); const thirdInput = f.followReplacement('third-exit', 1), third = await f.driver.start(thirdInput); expect(third).toMatchObject({ phase: 'exit_closed', remainingQty: '0.00000' }); expect(nativeExitCompletion(third.id, f.journal, f.now()).depth).toBe(2); expect(f.effects).toEqual(['cancel', 'sell', 'protect', 'cancel', 'sell', 'protect', 'cancel', 'sell']); expect(f.journal.unresolved()).toHaveLength(0); expect(Number(f.c.quote)).toBe(1000); });
test('successive tightening traverses replacement ancestors without a model sell or lowered stop', async () => { const f = fixture(); const first = await f.driver.tighten(f.input, '97'), secondInput = f.followReplacement('tighten-again'), second = await f.driver.tighten(secondInput, '98'); expect(second.phase).toBe('exit_protected'); expect(f.protectCommand?.belowStopPrice).toBe('98'); expect(resolveNativeBracket(second.id, f.journal, f.now())).toMatchObject({ depth: 2, entryOrderId: 1 }); expect(f.effects).toEqual(['cancel', 'protect', 'cancel', 'protect']); expect(nativeBracketConsumed(first.id, f.journal)).toBe(true); });
test.each(['cancel', 'sell', 'protect'] as const)('later OCO lost %s response recovers after actual SQLite reopen exactly once', async (stage) => {
    const f = fixture();
    await f.driver.start(f.input);
    const next = f.followReplacement('lost-later-' + stage);
    if (stage === 'cancel')
        f.c.loseCancel = true;
    if (stage === 'sell')
        f.c.loseSell = true;
    if (stage === 'protect')
        f.c.loseProtect = true;
    const before = f.effects.filter(e => e === stage).length, unknown = await f.driver.start(next);
    expect(unknown.phase).toContain('unknown');
    f.reopen();
    const result = await f.driver.resume(unknown.id);
    expect(result.phase).toBe('exit_protected');
    expect(f.effects.filter(e => e === stage)).toHaveLength(before + 1);
    expect(resolveNativeBracket(result.id, f.journal, f.now()).depth).toBe(2);
});
test('replacement stop coverage and selected-policy basis use the root entry instead of a missing OCO workingPrice', async () => { const f = fixture(); await f.driver.tighten(f.input, '97'); const next = f.followReplacement('coverage'), position = next.account.positions[0]!, coverage = stopCoverage(position, next.openOrders, f.journal, f.now()); expect(coverage).toMatchObject({ valid: true, covered: true, quantity: 1, stopValue: 97 }); const policy = effectiveTradingPolicy({ mode: 'safe', stopLossPct: .05, revision: 0, updatedAt: null }, policyHard), state = nativePolicyProtection(next.account, next.openOrders, f.journal, [f.symbol], policy, .005); expect(state).toMatchObject({ matches: true, pending: [] }); });
test('replacement ancestry rejects unknown roots, cycles, missing audit origin and future receipts', async () => {
    const f = fixture(), first = await f.driver.start(f.input), base = f.journal.get.bind(f.journal), row = base(first.id)!;
    for (const variant of ['missing', 'cycle', 'audit', 'future'] as const) {
        const proxy = new Proxy(f.journal, { get(target, key) {
                if (key === 'get')
                    return (id: string) => {
                        const original = base(id);
                        if (variant === 'missing' && id !== first.id)
                            return undefined;
                        if ((variant === 'cycle' || variant === 'future') && id === first.id) {
                            const changed = { ...row };
                            if (variant === 'cycle') {
                                const e = JSON.parse(changed.payload);
                                e.plan.parentId = first.id;
                                changed.payload = JSON.stringify(e);
                            }
                            else {
                                const r = JSON.parse(changed.result);
                                r.lastObservation.completedAt = f.now() + 1;
                                changed.result = JSON.stringify(r);
                            }
                            return changed;
                        }
                        return original;
                    };
                if (key === 'audit' && variant === 'audit')
                    return () => ({ ...f.journal.audit(first.id), recordedFromOrigin: false });
                const value = Reflect.get(target, key);
                return typeof value === 'function' ? value.bind(target) : value;
            } });
        expect(() => resolveNativeBracket(first.id, proxy, f.now())).toThrow();
    }
});
test('lineage depth bound is explicit and does not silently accept an untraced ancestor', async () => { const f = fixture(); await f.driver.start(f.input); const next = f.followReplacement('depth-two'), second = await f.driver.start(next); expect(() => resolveNativeBracket(second.id, f.journal, f.now(), 1)).toThrow('bounded'); expect(resolveNativeBracket(second.id, f.journal, f.now(), 2).depth).toBe(2); });
test('fully completed multi-generation episode supplies a validated cooldown while original entry receipt is retained', async () => { const f = fixture(), first = await f.driver.start(f.input), next = f.followReplacement('complete-episode', 1), last = await f.driver.start(next), completion = nativeExitCompletion(last.id, f.journal, f.now()); expect(completion).toMatchObject({ pair: 'BTC/EUR', remainingQty: '0.00000', quantityDust: false, depth: 1, actualPnlVerified: false }); expect(f.journal.get(completion.rootEntryId)!.state).toBe('accepted'); expect(nativeCompletedEntries(f.journal, f.now())[completion.rootEntryId]).toEqual(completion); const policy = effectiveTradingPolicy({ mode: 'safe', stopLossPct: .05, revision: 0, updatedAt: null }, policyHard), limits = nativePolicyLimits({ enabled: false, acknowledgement: '', quote: 'EUR', maxOrderQuote: 500, maxPositionPct: .3, maxPositions: 4, maxTradesPerDay: 10, maxDrawdownPct: .1, riskPerTradePct: .01, maxPortfolioRiskPct: .025, feeReservePct: .005, maxSpreadBps: 20, maxSlippageBps: 10 }, policy); expect(nativePolicyActivity(f.journal, f.now()).observedExits['BTC/EUR']).toBe(completion.recordedAt); f.advance(120 * 60000 - 500); expect(nativeEntryPolicyGuard(policy, limits, f.journal, 'BTC/EUR', 1, f.now())).toContain('Cooldown'); f.advance(501); expect(nativeEntryPolicyGuard(policy, limits, f.journal, 'BTC/EUR', 1, f.now())).toBeNull(); expect(first.phase).toBe('exit_protected'); });
test('immediately filled replacement and actual native fill during cancel both yield closure evidence without fabricated sell fills', async () => {
    for (const direct of [true, false]) {
        const f = fixture();
        if (direct)
            f.c.cancelFill = '1';
        else
            f.c.protectFill = true;
        const closed = await f.driver.start(f.input), completion = nativeExitCompletion(closed.id, f.journal, f.now());
        expect(completion.remainingQty).toMatch(/^0(?:\.0+)?$/);
        expect(completion.actualPnlVerified).toBe(false);
        expect(f.effects.filter(e => e === 'sell')).toHaveLength(direct ? 0 : 1);
    }
});
test('quantity dust completion retains its exact residual instead of pretending the position is zero', async () => { const f = fixture(); f.c.cancelFill = '.999995'; const result = await f.driver.start(f.input); expect(nativeExitCompletion(result.id, f.journal, f.now())).toMatchObject({ quantityDust: true, remainingQty: '0.000005' }); });
test('terminal label alone, contradictory fees or foreign numeric IDs do not create a completed-entry allowance', async () => {
    const f = fixture();
    f.input.action.sellFraction = 1;
    const result = await f.driver.start(f.input), get = f.journal.get.bind(f.journal);
    for (const variant of ['balance', 'fees', 'id', 'origin'] as const) {
        const proxy = new Proxy(f.journal, { get(target, key) {
                if (key === 'get')
                    return (id: string) => {
                        const row = get(id);
                        if (!row || id !== result.id)
                            return row;
                        const changed = { ...row }, r = JSON.parse(row.result);
                        if (variant === 'balance')
                            r.lastObservation.account.balances[1].free = '1';
                        if (variant === 'fees')
                            r.lastObservation.trades['4'][0].commission = '.001';
                        if (variant === 'id')
                            r.lastObservation.sellOrder.orderId = 999;
                        changed.result = JSON.stringify(r);
                        return changed;
                    };
                if (key === 'audit' && variant === 'origin')
                    return () => ({ ...f.journal.audit(result.id), recordedFromOrigin: false });
                const value = Reflect.get(target, key);
                return typeof value === 'function' ? value.bind(target) : value;
            } });
        expect(() => nativeExitCompletion(result.id, proxy, f.now())).toThrow();
        expect(Object.keys(nativeCompletedEntries(proxy, f.now()))).toHaveLength(0);
    }
});
test('actual native broker respects derived exit cooldown then permits a fresh offline no-fill attempt without querying obsolete parent children', async () => {
    const f = fixture();
    f.input.action.sellFraction = 1;
    const finished = await f.driver.start(f.input), completion = nativeExitCompletion(finished.id, f.journal, f.now()), rootId = completion.rootEntryId, policy = effectiveTradingPolicy({ mode: 'safe', stopLossPct: .05, revision: 0, updatedAt: null }, policyHard), limits: LiveLimits = { enabled: true, acknowledgement: '', quote: 'EUR', maxOrderQuote: 500, maxPositionPct: .3, maxPositions: 4, maxTradesPerDay: 10, maxDrawdownPct: .1, riskPerTradePct: .01, maxPortfolioRiskPct: .025, feeReservePct: .005, maxSpreadBps: 20, maxSlippageBps: 10 }, calls: {
        path: string;
        id: string | null;
    }[] = [];
    let params = new URLSearchParams(), posts = 0;
    vi.spyOn(Date, 'now').mockImplementation(f.now);
    const request: typeof fetch = async (url, init) => {
        const u = new URL(String(url));
        calls.push({ path: u.pathname, id: u.searchParams.get('origClientOrderId') });
        if (u.pathname.endsWith('/exchangeInfo'))
            return Response.json({ symbols: [f.symbol] });
        if (u.pathname.endsWith('/time'))
            return Response.json({ serverTime: f.now() });
        if (u.pathname.endsWith('/account'))
            return Response.json({ canTrade: true, balances: [{ asset: 'EUR', free: f.c.quote, locked: '0' }] });
        if (u.pathname.endsWith('/openOrders'))
            return Response.json([]);
        if (u.pathname.endsWith('/depth'))
            return Response.json({ bids: [['100', '100']], asks: [['100.01', '100']] });
        if (u.pathname.endsWith('/opoco')) {
            posts++;
            params = new URLSearchParams(String(init?.body));
            return Response.json({ symbol: 'BTCEUR', orderListId: 100, listClientOrderId: params.get('listClientOrderId'), listStatusType: 'EXEC_STARTED', listOrderStatus: 'EXECUTING', orders: ['workingClientOrderId', 'pendingBelowClientOrderId', 'pendingAboveClientOrderId'].map((key, i) => ({ symbol: 'BTCEUR', orderId: 1001 + i, clientOrderId: params.get(key) })) });
        }
        if (u.pathname.endsWith('/order'))
            return Response.json({ symbol: 'BTCEUR', orderId: 1001, orderListId: 100, clientOrderId: u.searchParams.get('origClientOrderId'), side: 'BUY', type: 'LIMIT', timeInForce: 'FOK', price: params.get('workingPrice'), origQty: params.get('workingQuantity'), executedQty: '0', status: 'EXPIRED' });
        throw Error('Unexpected fake native request');
    };
    const client = new BinanceClient('testnet', 'offline-fixture-key', 'offline-fixture-secret', request), broker = new BinanceSpotExecutionAdapter(client, f.journal, limits, { read: () => policy }), action = { type: 'buy' as const, pair: 'BTC/EUR', amountEur: 100, stopLossPct: .05, takeProfitPct: .1, confidence: 1, reasoning: 'Offline next episode' };
    broker.setNativePortfolioRiskProvider((pairs,now)=>fixtureNativePortfolioEvidence(pairs,now));
    expect((await broker.place(action, 'too-early', policy.fingerprint)).ok).toBe(false);
    expect(posts).toBe(0);
    f.advance(121 * 60000);
    const result = await broker.place(action, 'after-confirmed-cooldown', policy.fingerprint);
    expect(result).toMatchObject({ ok: true });
    expect(posts).toBe(1);
    expect(calls.some(c => c.id?.startsWith(rootId))).toBe(false);
    expect(f.journal.get(rootId)!.state).toBe('accepted');
    expect(f.journal.recent(0).filter(i => i.side === 'buy' && i.state === 'not_filled')).toHaveLength(1);
    for (const [method, path] of [['DELETE', '/api/v3/orderList'], ['POST', '/api/v3/order'], ['POST', '/api/v3/orderList/oco']] as const)
        await expect(client.signed(method, path, {})).rejects.toThrow('not permitted');
    expect(posts).toBe(1);
});
test('a later native stop fill and base fee during OCO cancel reduce the fixed target exactly once', async () => { const f = fixture(); await f.driver.start(f.input); const next = f.followReplacement('later-native-fill'); f.c.cancelFill = '.1'; f.c.cancelBaseFee = '.0001'; f.c.aliasIds = true; const result = await f.driver.start(next); expect(result).toMatchObject({ phase: 'exit_protected', remainingQty: '0.25000' }); expect(compareDecimal(String(f.sell!.origQty), '.1499')).toBe(0); expect(resolveNativeBracket(result.id, f.journal, f.now()).depth).toBe(2); });
test('a replacement cannot be finally confirmed after the provider drops the original sale fee evidence', async () => {
    const f = fixture(), observe = f.transport.observe;
    let hide = true;
    vi.spyOn(f.transport, 'observe').mockImplementation(async (...args) => {
        const o = await observe(...args);
        if (hide && o.protectionList)
            o.sellOrder = null;
        return o;
    });
    const unknown = await f.driver.start(f.input);
    expect(unknown).toMatchObject({ phase: 'exit_reprotect_unknown', protected: false });
    expect(f.effects).toEqual(['cancel', 'sell', 'protect']);
    hide = false;
    const recovered = await f.driver.resume(unknown.id);
    expect(recovered.phase).toBe('exit_protected');
    expect(resolveNativeBracket(recovered.id, f.journal, f.now()).depth).toBe(1);
    expect(f.effects).toEqual(['cancel', 'sell', 'protect']);
});
test('later standalone exit cannot borrow an older ancestor numeric order id', async () => {
    const f = fixture();
    await f.driver.start(f.input);
    const next = f.followReplacement('reused-ancestor'), observe = f.transport.observe;
    vi.spyOn(f.transport, 'observe').mockImplementation(async (...args) => {
        const o = await observe(...args);
        if (o.sellOrder) {
            const previous = String(o.sellOrder.orderId);
            o.sellOrder.orderId = 2;
            o.trades['2'] = (o.trades[previous] ?? []).map((t: any) => ({ ...t, orderId: 2 }));
        }
        return o;
    });
    const result = await f.driver.start(next);
    expect(result.phase).toBe('exit_order_unknown');
    expect(f.effects).toEqual(['cancel', 'sell', 'protect', 'cancel', 'sell']);
});
test.each(['list', 'stop', 'target'] as const)('a later replacement cannot reuse an older ancestor %s id even when POST and GET agree', async (reused) => {
    const f = fixture();
    await f.driver.start(f.input);
    const next = f.followReplacement('reused-protection-' + reused), protect = f.transport.protect;
    vi.spyOn(f.transport, 'protect').mockImplementation(async (...args) => {
        await protect(...args);
        if (reused === 'list') {
            f.protectionList!.orderListId = 42;
            for (const r of f.protectionOrders)
                r.orderListId = 42;
        }
        else {
            const i = reused === 'stop' ? 0 : 1, oldId = reused === 'stop' ? 2 : 3;
            f.protectionOrders[i]!.orderId = oldId;
            const list = f.protectionList!.orders as any[];
            list[i].orderId = oldId;
        }
        return structuredClone(f.protectionList);
    });
    const result = await f.driver.start(next);
    expect(result).toMatchObject({ phase: 'exit_reprotect_unknown', protected: false });
    expect(f.effects).toEqual(['cancel', 'sell', 'protect', 'cancel', 'sell', 'protect']);
    expect(nativeCompletedEntries(f.journal, f.now())).toEqual({});
});
test('drawdown halt survives proven native reduction and repeated tightening without preventing risk reduction', async () => { const f = fixture(); f.journal.setMeta('halt', 'Drawdown limit'); const first = await f.driver.start(f.input), next = f.followReplacement('drawdown-tighten'), second = await f.driver.tighten(next, '97'); expect(first.phase).toBe('exit_protected'); expect(second.phase).toBe('exit_protected'); expect(f.journal.getMeta('halt')).toBe('Drawdown limit'); expect(f.effects).toEqual(['cancel', 'sell', 'protect', 'cancel', 'protect']); });
test.each(['extra-buy', 'different-list'] as const)('fresh %s cannot hide behind previously valid parent receipts before cancel', async (problem) => { const f = fixture(), observe = f.transport.observe; vi.spyOn(f.transport, 'observe').mockImplementation(async (...args) => { const o = await observe(...args); if (problem === 'extra-buy')
    o.openOrders.push({ symbol: 'BTCEUR', orderId: 999, orderListId: -1, clientOrderId: 'foreign', side: 'BUY', type: 'LIMIT', status: 'NEW', origQty: '.1', executedQty: '0' });
else
    o.openOrders[0]!.orderListId = 999; return o; }); const result = await f.driver.start(f.input); expect(result.phase).toBe('exit_prepared'); expect(f.effects).toHaveLength(0); });
test('new manual reconciliation halt after capture prevents cancellation while original bracket remains', async () => { const f = fixture(), observe = f.transport.observe; vi.spyOn(f.transport, 'observe').mockImplementation(async (...args) => { const o = await observe(...args); f.journal.setMeta('halt', 'Manual reconciliation'); return o; }); const result = await f.driver.start(f.input); expect(result.phase).toBe('exit_prepared'); expect(f.effects).toHaveLength(0); expect(f.journal.getMeta('halt')).toBe('Manual reconciliation'); });

test('verified exit context contains precise fees and actual replacement quantities without raw provider additions',async()=>{const f=fixture();f.c.sellBaseFee='.0005';const done=await f.driver.start(f.input),before=JSON.stringify(f.journal.recent(0)),history=nativeIntentContext(f.journal.recent(0),f.now(),20,f.journal),item=history.items.find(i=>i.id===done.id)!;expect(item.exit).toMatchObject({originVerified:true,proofStatus:'verified',observation:{state:'protected',remainingQty:'0.49950',protectedQty:'0.49950',retired:false}});expect(item.exit!.observation!.orders.find(r=>r.role==='sale')).toMatchObject({executedQty:'0.50000',quoteQty:'50',feesByAsset:{BTC:'0.0005'},tradeCount:1});expect(item.exit!.observation!.orders).toHaveLength(5);expect(history.verifiedTradeLedger).toBe(false);expect(JSON.stringify(f.journal.recent(0))).toBe(before);});
test('exit plan without the original journal never becomes a verified execution history',async()=>{const f=fixture(),done=await f.driver.start(f.input),history=nativeIntentContext(f.journal.recent(0),f.now()),item=history.items.find(i=>i.id===done.id)!;expect(item.exit).toMatchObject({originVerified:false,proofStatus:'journal-unavailable',observation:null});expect(item.exit!.plan.targetRemainingQty).toBe('0.5');});
test('completed exits and superseded protection stay distinct historical observations',async()=>{const f=fixture(),first=await f.driver.start(f.input),next=f.followReplacement('context-final',1),last=await f.driver.start(next),history=nativeIntentContext(f.journal.recent(0),f.now(),20,f.journal);expect(history.items.find(i=>i.id===first.id)!.exit!.observation).toMatchObject({state:'protected',retired:true});expect(history.items.find(i=>i.id===last.id)!.exit!.observation).toMatchObject({state:'closed',remainingQty:'0.00000',protectedQty:'0',retired:true});});
test('unresolved or mismatched snapshots never turn a last-known planned remainder into a confirmed fill',async()=>{const f=fixture();f.c.loseSell=true;const unknown=await f.driver.start(f.input),rows=f.journal.recent(0),history=nativeIntentContext(rows,f.now(),20,f.journal);expect(history.items.find(i=>i.id===unknown.id)!.exit!.observation).toBeNull();const row=rows.find(i=>i.id===unknown.id)!,payload=JSON.parse(row.payload),raw=JSON.parse(row.result);payload.apiKey='fixture-secret-never-forward';raw.providerMessage='fixture-secret-never-forward';const changed={...row,payload:JSON.stringify(payload),result:JSON.stringify(raw)},view=nativeIntentContext([changed],f.now(),20,f.journal);expect(view.items[0]!.exit!.originVerified).toBe(false);expect(view.items[0]!.exit!.observation).toBeNull();expect(JSON.stringify(view)).not.toContain('fixture-secret-never-forward');});
test('twenty full validated exit summaries retain every market, feature and policy within the fixed model budget',async()=>{const f=fixture();f.c.sellBaseFee='.0005';await f.driver.start(f.input);for(let i=1;i<=18;i++){const next=f.followReplacement('context-tighten-'+i);expect((await f.driver.tighten(next,(95+i/100).toFixed(2))).phase).toBe('exit_protected');}const last=f.followReplacement('context-close',1);await f.driver.start(last);const rows=f.journal.recent(0).filter(r=>r.side==='sell'),history=nativeIntentContext(rows,f.now(),20,f.journal);expect(history.items).toHaveLength(20);expect(history.items.every(i=>i.exit?.proofStatus==='verified')).toBe(true);const source=new URL('../../../docs/verification-runs/native-stress-1793382731407-204891292da67c84e753720e84b659f4f9f4d8a5e252040ae9cca507660f9db3.json',import.meta.url),saved=JSON.parse(readFileSync(source,'utf8')),hash=(v:string)=>createHash('sha256').update(v).digest('hex');expect(hash(JSON.stringify(saved.context))).toBe(saved.sourceContextHash);const context=structuredClone(saved.context);context.execution.nativeOrderHistory=history;const before=JSON.stringify(context);if(process.env.EXIT_CONTEXT_STRESS_EXPORT==='true'){const folder=new URL('../../../data/context-budget-fixtures/',import.meta.url);mkdirSync(folder,{recursive:true});const file=new URL('full-exit-'+hash(before)+'.json',folder);writeFileSync(file,JSON.stringify({fixtureOnly:true,realModelTested:false,maxChars:115000,context,sourceContextHash:hash(before),historyItems:20,privateExchangeCalls:0,realOrders:0,paidCalls:0},null,2),{flag:'wx'});}const packed=packContext(context,115000),delivered=JSON.parse(packed.user);expect(delivered.marketContext.markets).toHaveLength(20);expect(delivered.features.map((v:unknown)=>readPackedRootFeature(v,delivered))).toEqual(context.features);expect(delivered.tradingPolicy).toEqual(context.tradingPolicy);expect(delivered.execution.nativeOrderHistory.items.map((v:unknown)=>readPackedNativeIntent(v,delivered))).toEqual(history.items);const candidates=new Set([...context.features].sort((a:any,b:any)=>b.volumeRatio-a.volumeRatio).slice(0,3).map((f:any)=>f.pair)),priority=(pair:string)=>pair.startsWith('BTC/')?2:candidates.has(pair)?1:0,expectedMemory=[...context.memory].sort((a:any,b:any)=>priority(b.pair)-priority(a.pair)).slice(0,8);expect(delivered.memory.map((v:unknown)=>readPackedMemoryRecord(v,delivered))).toEqual(expectedMemory);expect(JSON.stringify(context)).toBe(before);},60000);
