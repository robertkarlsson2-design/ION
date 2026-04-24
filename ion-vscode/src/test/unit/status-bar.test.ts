import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs/promises');

import { readFile } from 'node:fs/promises';
import { readTargetFromConfig } from '../../config-reader';

const mockReadFile = vi.mocked(readFile);

describe('readTargetFromConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns target when ion.config.json is valid', async () => {
    mockReadFile.mockResolvedValue('{"target":"javascript"}' as never);
    const result = await readTargetFromConfig('/workspace');
    expect(result).toBe('javascript');
  });

  it('returns null when file is missing', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockReadFile.mockRejectedValue(err);
    const result = await readTargetFromConfig('/workspace');
    expect(result).toBeNull();
  });

  it('returns null when json is malformed', async () => {
    mockReadFile.mockResolvedValue('{not json}' as never);
    const result = await readTargetFromConfig('/workspace');
    expect(result).toBeNull();
  });

  it('returns null when target field is absent', async () => {
    mockReadFile.mockResolvedValue('{"name":"myproject"}' as never);
    const result = await readTargetFromConfig('/workspace');
    expect(result).toBeNull();
  });

  it('returns null when target is not a string', async () => {
    mockReadFile.mockResolvedValue('{"target":42}' as never);
    const result = await readTargetFromConfig('/workspace');
    expect(result).toBeNull();
  });
});
