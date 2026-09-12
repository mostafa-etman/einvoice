export type ZipStoreEntry = {
  name: string;
  body: Buffer;
};

function crc32(buf: Buffer): number {
  let crc = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i]!;
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (~crc) >>> 0;
}

/**
 * Build a ZIP (STORE / no compression). PDFs are already compressed internally.
 * Filenames must already be sanitized — this writer does not interpret paths.
 */
export function buildZipStore(entries: ZipStoreEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = entry.body;
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // STORE
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const localFile = Buffer.concat([local, name, data]);
    localParts.push(localFile);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(Buffer.concat([central, name]));

    offset += localFile.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, end]);
}

/** Safe ZIP entry name: no path separators, no traversal, unique suffix. */
export function safeInvoicePdfFilename(
  internalId: string,
  uniqueSuffix: string,
  used: Set<string>,
): string {
  let cleaned = '';
  for (const ch of String(internalId || 'invoice')) {
    const code = ch.charCodeAt(0);
    if (code < 32 || '\\/:*?"<>|.'.includes(ch)) cleaned += '_';
    else cleaned += ch;
  }
  cleaned = cleaned
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
    .trim();
  const suffix = String(uniqueSuffix || 'id')
    .replace(/[^a-zA-Z0-9_-]+/g, '')
    .slice(0, 12);
  const base = `${cleaned || 'invoice'}-${suffix || 'id'}.pdf`;
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let n = 2;
  while (used.has(`${cleaned || 'invoice'}-${suffix}-${n}.pdf`)) n += 1;
  const next = `${cleaned || 'invoice'}-${suffix}-${n}.pdf`;
  used.add(next);
  return next;
}
