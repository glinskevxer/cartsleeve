import { describe, expect, it } from 'vitest';
import {
  COMMA,
  PIPE,
  TAB,
  quoteField,
  readRows,
  readTable,
  writeRow,
  writeRows,
  writeTable,
} from '../../src/util/delimited.js';
import { expectErr, expectOk } from '../support/result.js';

describe('readRows', () => {
  it('reads a plain document', () => {
    expect(expectOk(readRows('a,b,c\n1,2,3\n'))).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('does not need a trailing newline', () => {
    expect(expectOk(readRows('a,b\n1,2'))).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('tolerates carriage returns from a windows export', () => {
    expect(expectOk(readRows('a,b\r\n1,2\r\n'))).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('keeps a delimiter inside a quoted field', () => {
    expect(expectOk(readRows('title,artist\n"Sit Down, Stand Up",Radiohead\n'))).toEqual([
      ['title', 'artist'],
      ['Sit Down, Stand Up', 'Radiohead'],
    ]);
  });

  it('reads a doubled quote as one literal quote', () => {
    expect(expectOk(readRows('title\n"She Said ""Yes"""\n'))).toEqual([
      ['title'],
      ['She Said "Yes"'],
    ]);
  });

  it('keeps a newline inside a quoted field', () => {
    const rows = expectOk(readRows('note\n"line one\nline two"\n'));
    expect(rows).toEqual([['note'], ['line one\nline two']]);
  });

  it('keeps an empty field as an empty string', () => {
    expect(expectOk(readRows('a,,c\n'))).toEqual([['a', '', 'c']]);
    expect(expectOk(readRows('a,"",c\n'))).toEqual([['a', '', 'c']]);
  });

  it('reads an empty document as no rows', () => {
    expect(expectOk(readRows(''))).toEqual([]);
  });

  it('reports a file that ends inside a quoted field', () => {
    expect(expectErr(readRows('a\n"unterminated\n')).reason).toContain('ended inside');
  });

  it('reports a quote that appears mid field', () => {
    const problem = expectErr(readRows('a\nbad"quote\n'));
    expect(problem.reason).toContain('unquoted');
    expect(problem.line).toBe(2);
  });

  it('reads pipe and tab delimited exports', () => {
    expect(expectOk(readRows('a|b\n1|2\n', PIPE))).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(expectOk(readRows('a\tb\n1\t2\n', TAB))).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('leaves a comma alone in a pipe delimited file', () => {
    expect(expectOk(readRows('title|artist\nSit Down, Stand Up|Radiohead\n', PIPE))).toEqual([
      ['title', 'artist'],
      ['Sit Down, Stand Up', 'Radiohead'],
    ]);
  });
});

describe('readTable', () => {
  it('keys each row by its column name', () => {
    const table = expectOk(readTable('cart,title\nM0001,Wichita Lineman\n'));
    expect(table.header).toEqual(['cart', 'title']);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]?.get('title')).toBe('Wichita Lineman');
  });

  it('rejects a document with no header row', () => {
    expect(expectErr(readTable('')).reason).toContain('no header');
  });

  it('rejects a duplicated column name', () => {
    expect(expectErr(readTable('cart,cart\n1,2\n')).reason).toContain('twice');
  });

  it('names the line where the field count goes wrong', () => {
    const problem = expectErr(readTable('a,b\n1,2\n3\n'));
    expect(problem.line).toBe(3);
    expect(problem.reason).toContain('1 fields');
  });

  it('accepts a header with no body rows', () => {
    expect(expectOk(readTable('a,b\n')).rows).toEqual([]);
  });
});

describe('writing', () => {
  it('quotes only what has to be quoted', () => {
    expect(quoteField('Radiohead')).toBe('Radiohead');
    expect(quoteField('Sit Down, Stand Up')).toBe('"Sit Down, Stand Up"');
    expect(quoteField('She Said "Yes"')).toBe('"She Said ""Yes"""');
    expect(quoteField('line one\nline two')).toBe('"line one\nline two"');
    expect(quoteField(' padded ')).toBe('" padded "');
  });

  it('quotes against the delimiter actually in use', () => {
    expect(quoteField('Sit Down, Stand Up', PIPE)).toBe('Sit Down, Stand Up');
    expect(quoteField('a|b', PIPE)).toBe('"a|b"');
  });

  it('writes a row and a document', () => {
    expect(writeRow(['a', 'b,c'])).toBe('a,"b,c"');
    expect(
      writeRows([
        ['a', 'b'],
        ['1', '2'],
      ]),
    ).toBe('a,b\n1,2\n');
    expect(writeRows([])).toBe('');
  });

  it('writes records under a fixed column order and blanks the absent', () => {
    const rows = [new Map([['title', 'Wichita Lineman']])];
    expect(writeTable(['cart', 'title'], rows)).toBe('cart,title\n,Wichita Lineman\n');
  });

  it('round trips a document that needs every escape', () => {
    const original = [
      ['cart', 'title', 'note'],
      ['M0001', 'Sit Down, Stand Up', 'She Said "Yes"'],
      ['M0002', 'line one\nline two', ''],
    ];
    expect(expectOk(readRows(writeRows(original, COMMA), COMMA))).toEqual(original);
  });
});
