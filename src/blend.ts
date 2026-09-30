import fs from 'node:fs';
import path from 'node:path';

const SCRIPT_PATH = path.join(import.meta.dir, 'blend.py');

export interface BlendEntry {
  glb: string;
  blend: string;
}

export interface BlendBatchResult {
  sizes: Map<string, number>;
  failed: string[];
}

export const blend_batch_write = async (
  entries: BlendEntry[],
  manifest_path: string
): Promise<BlendBatchResult> => {
  const sizes = new Map<string, number>();
  const failed: string[] = [];

  if (entries.length === 0)
    return { sizes, failed };

  await fs.promises.writeFile(manifest_path, JSON.stringify(entries));

  const child = Bun.spawn(
    ['blender', '--background', '--factory-startup', '--python', SCRIPT_PATH, '--', manifest_path],
    { stdout: 'pipe', stderr: 'pipe' }
  );

  const [output, detail] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text()
  ]);

  const exit_code = await child.exited;

  if (exit_code !== 0)
    throw new Error('blender exited ' + exit_code + ': ' + detail.trim().split('\n').slice(-3).join(' | '));

  for (const line of output.split('\n')) {
    if (line.startsWith('BATCH_FAIL ') === false)
      continue;

    failed.push(line.slice('BATCH_FAIL '.length).split(' :: ')[0] ?? '');
  }

  for (const entry of entries) {
    try {
      const stat = await fs.promises.stat(entry.blend);
      sizes.set(entry.blend, stat.size);
    } catch {
      failed.push(entry.glb);
    }
  }

  return { sizes, failed };
};
