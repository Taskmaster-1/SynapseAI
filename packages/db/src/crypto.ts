/**
 * AES-256-GCM encryption for secrets at rest (OAuth tokens, provider keys).
 * The key is derived from SYNAPSE_SECRET; rotating it requires re-connecting integrations.
 */
const enc = new TextEncoder();
const dec = new TextDecoder();

export class SecretBox {
  private constructor(private readonly key: CryptoKey) {}

  static async fromSecret(secret: string): Promise<SecretBox> {
    if (secret.length < 32) throw new Error("SYNAPSE_SECRET must be at least 32 characters");
    const material = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, [
      "deriveKey",
    ]);
    const key = await crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: enc.encode("synapse/secret-box/v1"),
        info: new Uint8Array(),
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    return new SecretBox(key);
  }

  async seal(plaintext: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, this.key, enc.encode(plaintext)),
    );
    return `v1.${Buffer.from(iv).toString("base64url")}.${Buffer.from(ct).toString("base64url")}`;
  }

  async open(sealed: string): Promise<string> {
    const [version, iv, ct] = sealed.split(".");
    if (version !== "v1" || !iv || !ct) throw new Error("unrecognised secret format");
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: Buffer.from(iv, "base64url") },
      this.key,
      Buffer.from(ct, "base64url"),
    );
    return dec.decode(pt);
  }
}
