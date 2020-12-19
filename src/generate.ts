// running this will generate all pgp keys into .keys/
import dotenv from "dotenv";
import fs from 'fs';
import * as openpgp from "openpgp";
import path from "path";

dotenv.config();

const KEYS_DIR = path.resolve(`${__dirname}/../.keys`);

if (fs.existsSync(KEYS_DIR)) {
  console.warn('Seems like the cryptographic keys are already generated');
  process.exit();
} else {
  fs.mkdirSync(KEYS_DIR);
}


function writeKeyToFile(name: 'private.key' | 'public.key' | 'rev.cert', data: string) {
  fs.writeFileSync(path.resolve(KEYS_DIR, name), data, { encoding: 'utf-8' });
}

(async () => {
  const key = await openpgp.generateKey({
    userIds: [{ name: process.env['KEY_ID'] }],
    numBits: 4096
  });

  writeKeyToFile('private.key', key.privateKeyArmored);
  writeKeyToFile('public.key', key.publicKeyArmored);
  writeKeyToFile('rev.cert', key.revocationCertificate);
})();
