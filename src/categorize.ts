const MPQ_PREFIX = /^.*?\.mpq[\\/]/i;

const GROUP_MODEL_PATTERN = /(_\d\d\d_)|(_\d\d\d\.wmo$)|(lod\d\.wmo$)/i;

const FORMAT_SEGMENTS = new Set(['wmo']);

export const mpq_prefix_strip = (display_path: string): string => {
  return display_path.replace(MPQ_PREFIX, '');
};

const segments_resolve = (display_path: string): string[] => {
  return mpq_prefix_strip(display_path)
    .toLowerCase()
    .split(/[\\/]+/)
    .filter(segment => segment.length !== 0);
};

const segment_sanitize = (value: string): string => {
  return value.replace(/[^a-z0-9_-]+/g, '_');
};

export const asset_root_resolve = (display_path: string): string => {
  return segments_resolve(display_path)[0] ?? '';
};

export const asset_category_resolve = (display_path: string): string => {
  return segments_resolve(display_path)
    .slice(0, -1)
    .filter(segment => FORMAT_SEGMENTS.has(segment) === false)
    .map(segment_sanitize)
    .join('/');
};

export const asset_slug_resolve = (display_path: string): string => {
  const segments = segments_resolve(display_path);
  const base_name = segments[segments.length - 1] ?? '';

  return segment_sanitize(base_name.replace(/\.[^.]+$/, ''));
};

export const asset_dir_resolve = (display_path: string): string => {
  const category = asset_category_resolve(display_path);
  const slug = asset_slug_resolve(display_path);
  const parts = category.split('/').filter(segment => segment.length !== 0);

  if (parts[parts.length - 1] === slug)
    return category;

  if (category.length === 0)
    return slug;

  return category + '/' + slug;
};

export const is_group_model = (display_path: string): boolean => {
  return GROUP_MODEL_PATTERN.test(mpq_prefix_strip(display_path));
};

export const model_extension_resolve = (display_path: string): string => {
  const segments = segments_resolve(display_path);
  const base_name = segments[segments.length - 1] ?? '';
  const dot_index = base_name.lastIndexOf('.');

  if (dot_index < 0)
    return '';

  return base_name.slice(dot_index);
};
