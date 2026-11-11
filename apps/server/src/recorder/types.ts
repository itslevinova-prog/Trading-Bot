export type RecorderEventType = 'connect' | 'disconnect' | 'reconnect' | 'gap_start' | 'gap_end' | 'stale_book' | 'sequence_error' | 'storage_paused' | 'storage_resumed' | 'queue_overflow';
export type BookSnapshot = {
  ts: number; symbol: string; bid: number; bidQty: number; ask: number; askQty: number;
  spreadBps: number; depthBid10bps: number; depthAsk10bps: number;
  depthBid25bps: number; depthAsk25bps: number;
};
export type AggTrade = {ts: number; symbol: string; aggId: number; price: number; qty: number; isBuyerMaker: boolean; receivedAt?: number};
export type RecorderEvent = {ts: number; symbol: string | null; type: RecorderEventType; detail?: string};
export type RecorderHeartbeat = {
  startedAt: number; updatedAt: number; lastWriteAt: number | null; lastMessageAt: number | null;
  pairCount: number; status: 'starting' | 'recording' | 'paused_disk' | 'reconnecting' | 'stopping' | 'stopped';
  queued: number; month: string;
};
