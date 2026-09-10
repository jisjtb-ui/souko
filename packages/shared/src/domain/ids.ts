/** Entity identifier. Opaque string so the storage layer can swap ID strategies. */
export type ID = string;

let counter = 0;

/**
 * Creates a sortable, collision-resistant id with a readable type prefix.
 * Example: `rack_lz4f9k2_0007`
 */
export function createId(prefix: string): ID {
  counter = (counter + 1) % 100000;
  const time = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 0xffffff)
    .toString(36)
    .padStart(4, '0');
  return `${prefix}_${time}${rand}${counter.toString(36)}`;
}
