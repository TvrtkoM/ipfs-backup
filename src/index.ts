import * as openpgp from "openpgp";
import fs from "fs";
import os from "os";
import path from "path";
import dotenv from "dotenv";
import IPFSClient from "ipfs-http-client";
import { SHA256 } from "crypto-js";
import all from 'it-all';

import { DB_PATH, KEYS_DIR } from './lib/constants';

dotenv.config();

function readKey(fn: "public.key" | "private.key" | "rev.cert"): string {
  return fs.readFileSync(path.resolve(KEYS_DIR, fn), "utf-8");
}

const publicArKey = readKey("public.key");
const privateArKey = readKey("private.key");
// const revCertAr = readKey('rev.cert');

interface DbEntry {
  id: number;
  filename: string;
  cid: string;
  hash: string;
}

interface Options {
  FILES_CONFIG: string;
  IPFS_CLIENT_URL: string;
}

function parseEnvironmentVariables(): Options {
  const requiredOptionKeys: (keyof Options)[] = [
    "FILES_CONFIG",
    "IPFS_CLIENT_URL",
  ];

  const fillOptions: Partial<Options> = {};
  for (const k of requiredOptionKeys) {
    if (process.env[k] == null) {
      console.warn(
        "write .env file from .env.example. configuration options missing"
      );
      process.exit();
    }
    fillOptions[k] = process.env[k];
  }
  return fillOptions as Options;
}

const options = parseEnvironmentVariables();

function expandHomeDir(pth: string): string {
  if (pth[0] === "~") {
    return pth.replace(/~/g, os.homedir());
  }
  return pth;
}

class Db {
  static id = 0;

  private ipfsClient = IPFSClient({ url: options.IPFS_CLIENT_URL });

  constructor(
    private entries: DbEntry[] = [],
    private publicKey: openpgp.key.KeyResult,
    private privateKey: openpgp.key.KeyResult
  ) {}

  save(p: string) {
    fs.writeFileSync(p, JSON.stringify(this.entries), "utf-8");
  }

  async update(id: number, content: Buffer) {
    const h = SHA256(content.toString("binary")).toString();
    const item: DbEntry | undefined = this.entries.find((i) => i.id === id);
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
    console.log('updated', item);
  }

  async add(filename: string): Promise<DbEntry> {
    const content = fs.readFileSync(filename);
    const h = SHA256(content.toString("binary")).toString();

    const encrypted = await this.encrypt(content);

    const cid: string = (
      await this.ipfsClient.add({ content: encrypted }, { pin: true })
    ).cid.toString();

    const item: DbEntry = {
      hash: h,
      cid: cid,
      id: Db.id++,
      filename: filename,
    };

    return item;
  }

  async sync(files: string[]) {
    for (const file of files) {
      if (!this.fileExists(file)) {
        continue;
      }
      const eIdx = this.entries.findIndex((i) => i.filename === file);
      if (eIdx === -1) {
        const newEntry = await this.add(file);
        if (newEntry != null) this.entries = [...this.entries, newEntry];
      } else {
        await this.update(this.entries[eIdx].id, fs.readFileSync(file));
      }
    }
  }

  async printAllEntries() {
    for (const entry of this.entries) {
      const encData = this.ipfsClient.cat(`/ipfs/${entry.cid}`);
      const encString = (await all(encData)).toString();
      const decrypted = await this.decrypt(encString);
      console.log(entry.filename);
      console.log(decrypted.toString('utf-8'));
    }
  }

  private async encrypt(content: Buffer): Promise<Buffer> {
    const encrypted = await openpgp.encrypt({
      message: openpgp.message.fromBinary(content),
      publicKeys: this.publicKey.keys,
    });
    return Buffer.from(encrypted.data);
  }

  private async decrypt(armored: string): Promise<Buffer> {
    const decrypted = await openpgp.decrypt({
      message: await openpgp.message.readArmored(armored),
      privateKeys: this.privateKey.keys[0],
    })
    return Buffer.from(decrypted.data);
  }

  private fileExists(pth: string): boolean {
    return fs.existsSync(pth);
  }
}

class DbFactory {
  private static dbPath = DB_PATH;

  static createDb(options: {
    publicKey: openpgp.key.KeyResult;
    privateKey: openpgp.key.KeyResult;
  }): Db {
    // read entries from db.json. If a file doesn't exist create an empty array for entries
    const dbExists = fs.existsSync(DbFactory.dbPath);
    if (!dbExists) {
      return new Db([], options.publicKey, options.privateKey);
    }
    const entries: DbEntry[] = JSON.parse(
      fs.readFileSync(DbFactory.dbPath, "utf8")
    );
    return new Db(entries, options.publicKey, options.privateKey);
  }

  static save(db: Db) {
    db.save(DbFactory.dbPath);
  }
}

(async () => {
  const files: string[] = JSON.parse(
    fs.readFileSync(options.FILES_CONFIG, "utf8")
  ).map((f: string) => expandHomeDir(f));

  const db = DbFactory.createDb({
    publicKey: await openpgp.key.readArmored(publicArKey),
    privateKey: await openpgp.key.readArmored(privateArKey),
  });

  await db.sync(files);

  await db.printAllEntries();

  DbFactory.save(db);
})();

