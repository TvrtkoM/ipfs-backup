import fs from "fs";
import os from "os";
import dotenv from "dotenv";
import IPFSClient from "ipfs-http-client";
import all from "it-all";
import crypto from "crypto";

import { DB_PATH } from "./lib/constants";

dotenv.config();

interface DatabaseEntry {
  id: number;
  filename: string;
  cid: string;
  hash: string;
}

interface DatabaseJson {
  salt: string;
  iv: string;
  entries: DatabaseEntry[];
}

interface Environment {
  FILES_CONFIG: string;
  PASSWORD: string;
  IPFS_CLIENT_URL: string;
}

function parseEnvironmentVariables(): Environment {
  const requiredOptionKeys: (keyof Environment)[] = [
    "FILES_CONFIG",
    "PASSWORD",
    "IPFS_CLIENT_URL",
  ];

  const env: Partial<Environment> = {};
  for (const k of requiredOptionKeys) {
    if (process.env[k] == null) {
      console.warn(
        "write .env file from .env.example. configuration options missing"
      );
      process.exit();
    }
    env[k] = process.env[k];
  }
  return env as Environment;
}

const environment = parseEnvironmentVariables();

function expandHomeDir(pth: string): string {
  if (pth[0] === "~") {
    return pth.replace(/~/g, os.homedir());
  }
  return pth;
}

class Database {
  private nextId: number;

  private ipfsClient = IPFSClient({ url: environment.IPFS_CLIENT_URL });

  constructor(
    private entries: DatabaseEntry[] = [],
    private key: Buffer,
    private iv: string
  ) {
    this.nextId = entries.reduce((id: number, entry: DatabaseEntry) => {
      if (id < entry.id) {
        return entry.id;
      }
      return id + 1;
    }, 1);
  }

  getEntries(): DatabaseEntry[] {
    return this.entries;
  }

  async update(id: number, content: Buffer) {
    const h = this.calculateHash(content);
    const item: DatabaseEntry | undefined = this.entries.find(
      (i) => i.id === id
    );
    if (item == null || h === item?.hash) {
      return;
    }

    const encrypted = await this.encrypt(content);

    await this.ipfsClient.pin.rm(`/ipfs/${item.cid}`);
    const cid: string = (
      await this.ipfsClient.add({ content: encrypted }, { pin: true })
    ).cid.toString();

    item.cid = cid.toString();
    item.hash = h;
    console.log("updated", item.filename);
  }

  async add(filename: string): Promise<void> {
    const content = fs.readFileSync(filename);
    const h = this.calculateHash(content);

    const encrypted = await this.encrypt(content);

    const cid: string = (
      await this.ipfsClient.add({ content: encrypted }, { pin: true })
    ).cid.toString();

    const item: DatabaseEntry = {
      hash: h,
      cid: cid,
      id: this.nextId++,
      filename: filename,
    };

    this.entries = [...this.entries, item];
  }

  private calculateHash(content: Buffer): string {
    return crypto
      .createHash("sha256")
      .update(content.toString("binary"))
      .digest("hex");
  }

  async sync(files: string[]) {
    for (const file of files) {
      if (!this.fileExists(file)) {
        console.warn(`File ${file} doesn't exist, skipping upload...`);
        continue;
      }
      const eIdx = this.entries.findIndex((i) => i.filename === file);
      if (eIdx === -1) {
        console.log("adding file", file);
        await this.add(file);
      } else {
        await this.update(this.entries[eIdx].id, fs.readFileSync(file));
      }
    }
  }

  async downloadAll() {
    for (const entry of this.entries) {
      if (fs.existsSync(entry.filename)) {
        continue;
      }
      try {
        const encData = this.ipfsClient.cat(`/ipfs/${entry.cid}`);
        const enc = Buffer.concat(await all(encData));
        const decrypted = await this.decrypt(enc.toString().trimEnd());
        fs.writeFileSync(entry.filename, decrypted);

        console.log(`${entry.filename} downladed`);
      } catch (e) {
        console.log(e);
      }
    }
  }

  private encrypt(content: Buffer): Promise<string> {
    const cipher = crypto.createCipheriv("aes192", this.key, this.iv);
    return new Promise((resolve) => {
      let encrypted = "";
      cipher.on("readable", () => {
        let chunk;
        while ((chunk = cipher.read()) != null) {
          encrypted += chunk.toString("hex");
        }
      });
      cipher.on("end", () => resolve(encrypted));
      cipher.write(content);
      cipher.end();
    });
  }

  private decrypt(content: string): Promise<Buffer> {
    const decipher = crypto.createDecipheriv("aes192", this.key, this.iv);
    return new Promise<Buffer>((resolve) => {
      let decrypted: Buffer;
      decipher.on("readable", () => {
        let chunk: Buffer;
        while ((chunk = decipher.read()) != null) {
          if (!decrypted) {
            decrypted = chunk;
          } else {
            decrypted = Buffer.concat([decrypted, chunk]);
          }
        }
      });
      decipher.on("end", () => {
        resolve(decrypted);
      });
      decipher.write(content, "hex");
      decipher.end();
    });
  }

  private fileExists(pth: string): boolean {
    return fs.existsSync(pth);
  }
}

class DatabaseFactory {
  private static dbPath = DB_PATH;
  private static salt: string;
  private static iv: string;

  static createDb(password: string): Database {
    const dbExists = fs.existsSync(DatabaseFactory.dbPath);
    if (!dbExists) {
      const salt = crypto.randomBytes(2).toString("hex");
      DatabaseFactory.salt = salt;

      const iv = crypto.randomBytes(8).toString("hex");
      DatabaseFactory.iv = iv;

      const key = crypto.scryptSync(password, DatabaseFactory.salt, 24);
      return new Database([], key, DatabaseFactory.iv);
    }
    const databaseJson: DatabaseJson = JSON.parse(
      fs.readFileSync(DatabaseFactory.dbPath, "utf8")
    );

    DatabaseFactory.salt = databaseJson.salt;
    DatabaseFactory.iv = databaseJson.iv;

    const key = crypto.scryptSync(password, databaseJson.salt, 24);

    const entries: DatabaseEntry[] = databaseJson.entries;
    return new Database(entries, key, DatabaseFactory.iv);
  }

  static save(db: Database) {
    const dbJson: DatabaseJson = {
      salt: DatabaseFactory.salt,
      iv: DatabaseFactory.iv,
      entries: db.getEntries(),
    };
    fs.writeFileSync(DatabaseFactory.dbPath, JSON.stringify(dbJson));
  }
}

(async () => {
  const files: string[] = JSON.parse(
    fs.readFileSync(environment.FILES_CONFIG, "utf8")
  ).map((f: string) => expandHomeDir(f));

  const db = DatabaseFactory.createDb(environment.PASSWORD);

  await db.sync(files);

  await db.downloadAll();

  DatabaseFactory.save(db);
})();

