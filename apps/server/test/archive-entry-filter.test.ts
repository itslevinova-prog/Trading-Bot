import {describe, expect, it} from 'vitest';
import {selectEntries, type ArchiveObject} from '../src/archive/download.js';

const item = (symbol: string): ArchiveObject => ({key: `data/spot/monthly/klines/${symbol}/1d/${symbol}-1d-2020-11.zip`, size: 1, interval: '1d', symbol, date: '2020-11'});
const all = ['BTCUSDT', 'ETHUSDT', 'AUDUSDT', 'EURUSDT', 'USDCUSDT', 'BTCUPUSDT', 'ETHBULLUSDT', 'BTCEUR'].map(item);

describe('archive entry selection', () => {
  it('skips stablecoin/fiat bases and leveraged tokens for an all-USDT import', () => {
    expect(selectEntries(all, [], 'USDT').map(i => i.symbol)).toEqual(['BTCUSDT', 'ETHUSDT']);
  });
  it('keeps explicitly requested symbols unchanged', () => {
    expect(selectEntries(all, ['AUDUSDT', 'BTCUSDT'], 'USDT').map(i => i.symbol)).toEqual(['BTCUSDT', 'AUDUSDT']);
  });
  it('does not filter bases when all quotes are requested', () => {
    expect(selectEntries(all, [], 'all')).toHaveLength(all.length);
  });
});
