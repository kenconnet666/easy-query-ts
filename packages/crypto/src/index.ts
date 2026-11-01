/**
 * 列加密的现成策略（对应 Java 版的 AES / SM4 加密策略）：AES-CBC、SM4-CBC，密文是 Base64。
 * 核心只定义 `Encryption` 接口、不依赖 node:crypto；这个包给出常用的实现，配合 `encrypted()` 列用：
 *
 * ```ts
 * import { aesEncryption } from '@zerodep-dev/easy-query-ts-crypto'
 *
 * const phoneCipher = aesEncryption({ key: process.env.PHONE_KEY!, iv: process.env.PHONE_IV!, searchable: true })
 * const User = entity('t_user', { id: col.bigint().primaryKey(), phone: col.string().encrypted(phoneCipher) })
 * await db.queryable(User).where(u => u.phone.like('8888')).toList()   // 搜索词加密后匹配密文
 * ```
 *
 * `searchable: true` 是可分段搜索的写法（对应 Java 版的 AbstractSupportEmojiAesBase64EncryptionStrategy）：
 * 明文按窗口切开（从每个字符起取满 4 个单位，中文与 emoji 算 2 个），每段单独加密再拼起来，
 * 所以一个至少 4 个单位的搜索词的密文一定是整段密文的一部分。分段、权重、Base64 都与 Java 版一致，
 * 用同样的密钥能读 Java 版写进库里的数据。代价是密文变长（每个字符 24 个字符），固定 IV 也会暴露相同片段。
 */
import { createCipheriv, createDecipheriv } from 'node:crypto';
import type { Encryption } from '@zerodep-dev/easy-query-ts';

export interface CipherOptions {
  /** 密钥：AES 是 16 / 24 / 32 字节（对应 AES-128 / 192 / 256），SM4 是 16 字节；字符串按 UTF-8 取字节 */
  readonly key: string | Uint8Array;
  /** 16 字节的初始向量；字符串按 UTF-8 取字节。可分段搜索要求它固定 */
  readonly iv: string | Uint8Array;
  /** 可分段搜索：like / startsWith / endsWith 能用在加密列上（搜索词至少 4 个单位） */
  readonly searchable?: boolean;
}

/** AES-CBC（PKCS#7 填充），密钥长度决定 128 / 192 / 256 */
export function aesEncryption(options: CipherOptions): Encryption {
  const key = bytes(options.key, 'key');
  if (![16, 24, 32].includes(key.length))
    throw new Error(`aesEncryption: the key must be 16, 24 or 32 bytes, got ${key.length}`);
  return cipherEncryption(`aes-${key.length * 8}-cbc`, key, options);
}

/** SM4-CBC（国密，PKCS#7 填充），16 字节密钥 */
export function sm4Encryption(options: CipherOptions): Encryption {
  const key = bytes(options.key, 'key');
  if (key.length !== 16)
    throw new Error(`sm4Encryption: the key must be 16 bytes, got ${key.length}`);
  return cipherEncryption('sm4-cbc', key, options);
}

/** 分组都是 16 字节：每段明文不超过 13 字节，加密后正好一组，Base64 是 24 个字符 */
const SEGMENT_CIPHER_LENGTH = 24;

function cipherEncryption(algorithm: string, key: Uint8Array, options: CipherOptions): Encryption {
  const iv = bytes(options.iv, 'iv');
  if (iv.length !== 16) throw new Error(`${algorithm}: the iv must be 16 bytes, got ${iv.length}`);
  const encrypt = (plain: string): string => {
    const cipher = createCipheriv(algorithm, key, iv);
    return Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]).toString('base64');
  };
  const decrypt = (text: string): string => {
    const decipher = createDecipheriv(algorithm, key, iv);
    return Buffer.concat([decipher.update(text, 'base64'), decipher.final()]).toString('utf8');
  };
  if (!options.searchable) return { encrypt, decrypt };
  return {
    searchable: true,
    encrypt: (plain) => segments(plain).map(encrypt).join(''),
    decrypt: (text) => {
      if (text.length % SEGMENT_CIPHER_LENGTH !== 0)
        throw new Error(
          `${algorithm}: a searchable cipher text must be made of 24-character segments`,
        );
      const parts: string[] = [];
      for (let at = 0; at < text.length; at += SEGMENT_CIPHER_LENGTH) {
        const piece = decrypt(text.slice(at, at + SEGMENT_CIPHER_LENGTH));
        // 每段从下一个字符起重叠：前面的段只取第一个字符，最后一段取全部
        const last = at + SEGMENT_CIPHER_LENGTH === text.length;
        parts.push(last ? piece : (Array.from(piece)[0] ?? ''));
      }
      return parts.join('');
    },
  };
}

/** 一个窗口满多少个单位 */
const WINDOW = 4;

/**
 * 明文切成重叠的窗口：从每个字符起取到满 4 个单位为止，取到末尾就停（与 Java 版 getStringSafeCharSegments 相同）。
 * 空串是一段空串
 */
export function segments(plain: string): string[] {
  const chars = Array.from(plain);
  const out: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    let units = 0;
    let j = i;
    let segment = '';
    for (; j < chars.length && units < WINDOW; j++) {
      units += weight(chars[j]!);
      segment += chars[j];
    }
    out.push(segment);
    if (j === chars.length && units <= WINDOW) break;
  }
  return out.length > 0 ? out : [plain];
}

/** 一个字符占几个单位：代理对（emoji 等）与中文字符、符号算 2，其余算 1（按 Java 版 isChinese 的 Unicode 区块） */
function weight(char: string): number {
  if (char.length > 1) return 2;
  const c = char.charCodeAt(0);
  const wide =
    (c >= 0x4e00 && c <= 0x9fff) || // CJK Unified Ideographs
    (c >= 0xf900 && c <= 0xfaff) || // CJK Compatibility Ideographs
    (c >= 0x3400 && c <= 0x4dbf) || // CJK Extension A
    (c >= 0x3000 && c <= 0x303f) || // CJK Symbols and Punctuation
    (c >= 0xff00 && c <= 0xffef) || // Halfwidth and Fullwidth Forms
    (c >= 0x2000 && c <= 0x206f); // General Punctuation
  return wide ? 2 : 1;
}

function bytes(value: string | Uint8Array, what: string): Uint8Array {
  const out = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
  if (out.length === 0) throw new Error(`the cipher ${what} is empty`);
  return out;
}
