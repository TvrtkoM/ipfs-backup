// running this script removes db.json and unpins all files on ipfs
import fs from "fs";
import os from "os";
import path from "path";
import dotenv from "dotenv";
import IPFSClient from "ipfs-http-client";

dotenv.config();

function expandHomeDir(pth: string): string {
  if (pth[0] === "~") {
    return pth.replace(/~/g, os.homedir());
  }
  return pth;
}

const ipfsClient = IPFSClient({ url: process.env['IPFS_CLIENT_URL'] });

const DB_PATH = path.resolve(expandHomeDir("~/programming/js/ipfsbak/db.json"));

(async () => {
  const entries: {filename: string; cid: string}[] = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));

  entries.forEach(async (e) => {
    await ipfsClient.pin.rm(`/ipfs/${e.cid}`);
  });

  fs.unlinkSync(DB_PATH);
})();
