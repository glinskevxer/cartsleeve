import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../../src/store/storage.js';

describe('MemoryStorage', () => {
  it('reads an absent file as empty rather than throwing', () => {
    expect(new MemoryStorage().read('nothing')).toBe('');
    expect(new MemoryStorage().exists('nothing')).toBe(false);
  });

  it('appends, creating the file the first time', () => {
    const store = new MemoryStorage();
    store.append('a', 'one\n');
    store.append('a', 'two\n');
    expect(store.read('a')).toBe('one\ntwo\n');
    expect(store.exists('a')).toBe(true);
  });

  it('writes over whatever was there', () => {
    const store = new MemoryStorage();
    store.append('a', 'one\n');
    store.write('a', 'replaced\n');
    expect(store.read('a')).toBe('replaced\n');
  });

  it('keeps files apart', () => {
    const store = new MemoryStorage();
    store.append('a', 'one');
    store.append('b', 'two');
    expect(store.read('a')).toBe('one');
    expect(store.read('b')).toBe('two');
  });

  it('lists what it holds, sorted', () => {
    const store = new MemoryStorage();
    store.write('z', '');
    store.write('a', '');
    expect(store.names()).toEqual(['a', 'z']);
  });

  it('starts empty', () => {
    expect(new MemoryStorage().names()).toEqual([]);
  });
});
