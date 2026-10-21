// A small zip reader and writer on Node's own zlib (no dependency): enough for the asset pack.
//   const buf = writeZip([{ name: 'a/b.txt', data, compress: true }]);
//   for (const { name, data } of readZip(buf)) ...
// Entries are stored or deflated, without zip64 (each file and the whole archive under 4 GB).
import { deflateRawSync, inflateRawSync } from 'node:zlib';

const TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function writeZip(files) {
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.from(f.data);
    const packed = f.compress ? deflateRawSync(data, { level: 6 }) : data;
    const method = f.compress && packed.length < data.length ? 8 : 0;
    const body = method ? packed : data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);   // names in UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, body);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, name);
    offset += local.length + name.length + body.length;
  }
  const size = central.reduce((a, b) => a + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

export function* readZip(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('broken zip directory');
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16);
    const packed = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32), at = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extra + comment;
    const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
    const body = buf.subarray(start, start + packed);
    if (name.endsWith('/')) continue;
    const data = method === 8 ? inflateRawSync(body) : method === 0 ? body : null;
    if (!data) throw new Error(`${name}: unsupported zip method ${method}`);
    if (crc32(data) !== crc) throw new Error(`${name}: damaged (checksum)`);
    yield { name, data };
  }
}
