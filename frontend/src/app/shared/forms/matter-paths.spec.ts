import { HttpErrorResponse } from '@angular/common/http';
import { ApiError } from '../../core/http/api-error';
import {
  PATH_CREDENTIALS_MESSAGE,
  PATH_DRIVE_LETTER_MESSAGE,
  PATH_FORMAT_MESSAGE,
  isWebAddress,
  pathProblem,
  pathToSend,
  serverPathMessage,
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
    expect(pathToSend('  \\\\fs01\\share ')).toBe('\\\\fs01\\share');
    expect(pathToSend('  ')).toBeUndefined();
  });

  it('maps the API field codes to the same sentences', () => {
    const error = (code: string, message: string) =>
      new ApiError(
        400,
        'INVALID_PATH',
        message,
        { errors: { dmsPath: [{ code, message }] } },
        new HttpErrorResponse({ status: 400 }),
      );
    expect(serverPathMessage(error('PATH_DRIVE_LETTER', 'x'), 'dmsPath')).toBe(
      PATH_DRIVE_LETTER_MESSAGE,
    );
    expect(serverPathMessage(error('PATH_CREDENTIALS', 'x'), 'dmsPath')).toBe(
      PATH_CREDENTIALS_MESSAGE,
    );
    expect(serverPathMessage(error('PATH_FORMAT', 'x'), 'dmsPath')).toBe(PATH_FORMAT_MESSAGE);
    expect(serverPathMessage(error('PATH_FORMAT', 'x'), 'dfsPath')).toBeNull();
    expect(serverPathMessage(new Error('x'), 'dmsPath')).toBeNull();
  });
});
