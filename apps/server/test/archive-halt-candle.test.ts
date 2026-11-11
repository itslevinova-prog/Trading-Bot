import {expect, test} from 'vitest';
import {parseCsv} from '../src/archive/store.js';

const halt = '1608559200000,22646.53000000,22646.53000000,22646.53000000,22646.53000000,0.00000000,1608558440521,0.00000000,0,0.00000000,0.00000000,0';

test('accepts the exact Binance exchange-halt candle shape (BTCUSDT 1h 2020-12-21 14:00 UTC)', () => {
  expect(parseCsv(halt)).toEqual([{ts: 1608559200000, open: 22646.53, high: 22646.53, low: 22646.53, close: 22646.53, volume: 0, quoteVolume: 0, trades: 0}]);
});

test('still rejects closeTs before openTs when the candle traded or is not flat', () => {
  expect(() => parseCsv(halt.replace(',0.00000000,1608558440521', ',1.00000000,1608558440521'))).toThrow(/Invalid candle/);
  expect(() => parseCsv(halt.replace('22646.53000000,22646.53000000,22646.53000000,22646.53000000', '22646.53000000,22700.00000000,22646.53000000,22646.53000000'))).toThrow(/Invalid candle/);
});
