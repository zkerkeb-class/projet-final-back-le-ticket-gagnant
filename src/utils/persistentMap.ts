import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getSessionStoreSecret } from "../config/security";

type PersistedMapPayload<T> = {
  items: T[];
  signature: string;
};

export class PersistentMap<T extends { id: string }> {
  private readonly map = new Map<string, T>();
  private readonly secret: string;

  constructor(fileName: string) {
    const dataDir = path.join(process.cwd(), "data", "sessions");
    mkdirSync(dataDir, { recursive: true });
    this.filePath = path.join(dataDir, fileName);
    this.secret = getSessionStoreSecret();
    this.restore();
  }

  private readonly filePath: string;

  private sign(items: T[]): string {
    const serializedItems = JSON.stringify(items);
    return createHmac("sha256", this.secret).update(serializedItems).digest("hex");
  }

  private isSignatureValid(items: T[], signature: string): boolean {
    const expected = this.sign(items);
    const expectedBuffer = Buffer.from(expected, "hex");
    const receivedBuffer = Buffer.from(signature, "hex");

    if (expectedBuffer.length !== receivedBuffer.length) {
      return false;
    }

    return timingSafeEqual(expectedBuffer, receivedBuffer);
  }

  private restore() {
    if (!existsSync(this.filePath)) {
      return;
    }

    try {
      const raw = readFileSync(this.filePath, "utf-8");
      if (!raw.trim()) {
        return;
      }

      const parsed = JSON.parse(raw) as Partial<PersistedMapPayload<T>>;
      const items = Array.isArray(parsed?.items) ? parsed.items : [];
      const signature = typeof parsed?.signature === "string" ? parsed.signature : "";

      if (!signature || !this.isSignatureValid(items, signature)) {
        return;
      }

      items.forEach((item) => {
        if (item && typeof item.id === "string") {
          this.map.set(item.id, item);
        }
      });
    } catch {
      // ignore invalid persisted state and start fresh
    }
  }

  private persist() {
    const items = Array.from(this.map.values());
    const payload: PersistedMapPayload<T> = {
      items,
      signature: this.sign(items),
    };
    writeFileSync(this.filePath, JSON.stringify(payload), "utf-8");
  }

  get(id: string) {
    return this.map.get(id);
  }

  set(id: string, value: T) {
    this.map.set(id, value);
    this.persist();
  }

  has(id: string) {
    return this.map.has(id);
  }

  delete(id: string) {
    const deleted = this.map.delete(id);
    if (deleted) {
      this.persist();
    }
    return deleted;
  }
}