/**
 * A small JSONPath subset for reading one value: `$.data.items[0].id`, `$['odd key'].x`, or the
 * same without the leading `$`. Filters, wildcards and recursion are intentionally not supported.
 */
export function parseJsonPath(path) {
  const source = path.trim().replace(/^\$/, '');
  const tokens = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    if (char === '.') {
      index += 1;
      const match = /^[^.[\]]+/.exec(source.slice(index));
      if (!match) throw new Error('Expected a property name after "."');
      tokens.push(match[0]);
      index += match[0].length;
    } else if (char === '[') {
      const close = source.indexOf(']', index);
      if (close === -1) throw new Error('Missing "]"');
      const inner = source.slice(index + 1, close).trim();
      const quoted = /^(['"])(.*)\1$/.exec(inner);
      if (quoted) tokens.push(quoted[2]);
      else if (/^\d+$/.test(inner)) tokens.push(Number(inner));
      else throw new Error(`Unsupported selector [${inner}]`);
      index = close + 1;
    } else if (index === 0) {
      // A path without "$." such as "data.items[0]".
      const match = /^[^.[\]]+/.exec(source);
      tokens.push(match[0]);
      index += match[0].length;
    } else {
      throw new Error(`Unexpected "${char}"`);
    }
  }
  return tokens;
}

// Returns { found, value }. Throws only for an invalid path.
export function readJsonPath(data, path) {
  let current = data;
  for (const token of parseJsonPath(path)) {
    if (current === null || typeof current !== 'object' || !(token in Object(current))) {
      return { found: false, value: undefined };
    }
    current = current[token];
  }
  return { found: true, value: current };
}
