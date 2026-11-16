import { HttpErrorResponse } from '@angular/common/http';
import { ApiError } from '../../core/http/api-error';
import {
  PATH_CREDENTIALS_MESSAGE,
  PATH_DRIVE_LETTER_MESSAGE,
  PATH_FORMAT_MESSAGE,
  pathProblem,
  PATHS_MAX,
  PATHS_TOO_MANY_MESSAGE,
  PATH_DUPLICATE_MESSAGE,
  isWebAddress,
  newPathRow,
  pathListProblem,
  pathRowProblems,
  pathRowsOf,
  pathsToSend,
  serverPathMessages,
  typedPaths,
} from './matter-paths';

describe('DMS and DFS path rule (UI spec 3.3)', () => {
  it('accepts an empty value, UNC paths and http(s) addresses', () => {
    for (const ok of [
      '',
      '   ',
      '\\\\fs01\\matters\\1234\\Acme v. Beta\\',
      '\\\\fs01.corp-net\\share',
      'https://dfs.example.com/matters/1234/0056',
      'HTTP://host:8080/a?b=c#d',
    ]) {
      expect(pathProblem(ok), ok).toBeNull();
    }
  });

  it('refuses drive letters first, with the exact message', () => {
    for (const bad of ['C:\\Matters\\1234', 'z:\\share', 'D:/x']) {
      expect(pathProblem(bad), bad).toBe(PATH_DRIVE_LETTER_MESSAGE);
    }
    expect(PATH_DRIVE_LETTER_MESSAGE).toBe(
      'Drive-letter paths such as C:\\ are not accepted. Use a network path (\\\\server\\share\\...) or a web address (https://...).',
    );
  });

  it('refuses a user name and password in a web address', () => {
    expect(pathProblem('https://user:pw@host/x')).toBe(PATH_CREDENTIALS_MESSAGE);
    expect(PATH_CREDENTIALS_MESSAGE).toBe(
      'Remove the user name and password from the web address.',
    );
  });

  it('refuses everything else with the format message', () => {
    for (const bad of [
      '\\\\fs01',
      '//fs01/share',
      '\\fs01\\share',
      'ftp://host/x',
      'file:///x',
      'www.example.com',
      'https://',
      'javascript:alert(1)',
      '\\\\?\\C:\\x',
      '\\\\my server\\share',
      '\\\\fs01\\sha*re',
      'https://host/a b',
      'https://host/\nx',
    ]) {
      expect(pathProblem(bad), JSON.stringify(bad)).toBe(PATH_FORMAT_MESSAGE);
    }
    expect(PATH_FORMAT_MESSAGE).toBe(
      'Enter a network path (\\\\server\\share\\...) or a web address starting with http:// or https://.',
    );
  });

  it('knows which stored values are links and trims what is sent', () => {
    expect(isWebAddress('https://a.example/x')).toBe(true);
    expect(isWebAddress('\\\\fs01\\share')).toBe(false);
    expect(isWebAddress(undefined)).toBe(false);
  });

  it('starts a list with one empty line and keeps a stored list as it is', () => {
    expect(pathRowsOf(null).map((r) => r.text)).toEqual(['']);
    expect(pathRowsOf([]).map((r) => r.text)).toEqual(['']);
    const rows = pathRowsOf(['https://a.example/x', '\\\\fs01\\share']);
    expect(rows.map((r) => r.text)).toEqual(['https://a.example/x', '\\\\fs01\\share']);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });

  it('sends the typed paths trimmed, in order, without the empty lines, and remembers each line', () => {
    const rows = [
      newPathRow(' https://a.example/x '),
      newPathRow(' '),
      newPathRow('\\\\fs01\\share'),
    ];
    expect(typedPaths(rows)).toEqual(['https://a.example/x', '\\\\fs01\\share']);
    expect(pathsToSend(rows)).toEqual({
      values: ['https://a.example/x', '\\\\fs01\\share'],
      lineOf: [0, 2],
    });
  });

  it('checks every line by the one-path rule and flags the same path typed again, ignoring letter case', () => {
    const rows = [
      newPathRow('https://a.example/x'),
      newPathRow('C:\\x'),
      newPathRow(''),
      newPathRow('HTTPS://A.example/X'),
    ];
    expect(pathRowProblems(rows)).toEqual([
      null,
      PATH_DRIVE_LETTER_MESSAGE,
      null,
      PATH_DUPLICATE_MESSAGE,
    ]);
  });

  it('allows ten paths of a kind and refuses the eleventh', () => {
    const ten = Array.from({ length: PATHS_MAX }, (_, i) => newPathRow(`https://a.example/${i}`));
    expect(pathListProblem(ten)).toBeNull();
    expect(pathListProblem([...ten, newPathRow('https://a.example/11')])).toBe(
      PATHS_TOO_MANY_MESSAGE,
    );
    expect(pathListProblem([...ten, newPathRow('  ')])).toBeNull();
  });

  it('puts the API messages under the right line, by the field codes', () => {
    const error = (errors: Record<string, { code: string; message: string }[]>) =>
      new ApiError(400, 'INVALID_PATH', 'x', { errors }, new HttpErrorResponse({ status: 400 }));
    const result = serverPathMessages(
      error({
        'dmsPaths[0]': [{ code: 'PATH_FORMAT', message: 'x' }],
        'dmsPaths[1]': [{ code: 'PATH_DUPLICATE', message: 'x' }],
        dmsPaths: [{ code: 'TOO_MANY_PATHS', message: 'x' }],
        'dfsPaths[0]': [{ code: 'PATH_FORMAT', message: 'x' }],
      }),
      'dmsPaths',
      [0, 2],
    );
    expect(result).toEqual({
      lines: { 0: PATH_FORMAT_MESSAGE, 2: PATH_DUPLICATE_MESSAGE },
      list: PATHS_TOO_MANY_MESSAGE,
    });
    expect(serverPathMessages(new Error('x'), 'dmsPaths', [])).toEqual({ lines: {}, list: null });
    expect(
      serverPathMessages(
        error({ 'dmsPaths[0]': [{ code: 'PATH_CREDENTIALS', message: 'x' }] }),
        'dfsPaths',
        [0],
      ),
    ).toEqual({ lines: {}, list: null });
  });
});
