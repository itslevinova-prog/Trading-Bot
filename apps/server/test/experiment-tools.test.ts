import {test,expect} from 'vitest';
// Existing JS orchestration module consumes only locally compiled validators; no process starts at import.
// @ts-expect-error JS orchestration has no declaration file.
import {mockExperimentSelection,serializeMockEnvironment} from '../../../scripts/mock-experiment-files.mjs';
test('new series has distinct paths while both older selections stay exactly compatible',()=>{
 expect(mockExperimentSelection('v1')).toEqual({kind:'mock-forward-v1',pointerPath:'data/mock-experiment-current.json',protocolPath:'docs/mock-forward-protocol-v1.json',proofPath:'docs/mock-experiment-latest.json'});
 expect(mockExperimentSelection('v2').pointerPath).toBe('data/mock-experiment-v2-current.json');expect(mockExperimentSelection('v3')).toEqual({kind:'mock-forward-v3',pointerPath:'data/mock-experiment-v3-current.json',protocolPath:'docs/mock-forward-protocol-v3.json',proofPath:'docs/mock-experiment-v3-latest.json'});expect(()=>mockExperimentSelection('v4')).toThrow();
});
test('environment serialization preserves JSON pair quotes and actual newlines exactly',()=>{
 const text=serializeMockEnvironment({PAPER_FIXED_PAIRS:'["BTC/EUR","ETH/EUR"]',AI_ENABLED:false,AI_API_KEY:''});expect(text).toContain("PAPER_FIXED_PAIRS='[\"BTC/EUR\",\"ETH/EUR\"]'");expect(text.split('\n')).toHaveLength(4);expect(text).not.toContain('\\n');
});
test.each(["line\nbreak","single'quote","carriage\rreturn"])('unsafe environment literal is rejected',v=>expect(()=>serializeMockEnvironment({PAPER_FIXED_PAIRS:v})).toThrow());
