// running this script removes db.json and unpins all files on ipfs
import fs from "fs";
import dotenv from "dotenv";
import IPFSClient from "ipfs-http-client";

import { DB_PATH } from './lib/constants';

dotenv.config();

const ipfsClient = IPFSClient({ url: process.env['IPFS_CLIENT_URL'] });

(async () => {
  if (!fs.existsSync(DB_PATH)) {
    console.warn('Nothing to clean. No database file');
    process.exit();
  }
  const entries: {filename: string; cid: string}[] = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));

  entries.forEach(async (e) => {
    await ipfsClient.pin.rm(`/ipfs/${e.cid}`);
  });

  fs.unlinkSync(DB_PATH);
})();
