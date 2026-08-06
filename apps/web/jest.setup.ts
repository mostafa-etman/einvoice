import '@testing-library/jest-dom';
import 'fake-indexeddb/auto';

// fake-indexeddb 6+ requires structuredClone (not in older jsdom)
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = <T>(value: T): T =>
    JSON.parse(JSON.stringify(value)) as T;
}
