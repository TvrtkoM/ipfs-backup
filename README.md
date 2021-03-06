# Nodejs scripts for backing up files on IPFS

## Usage

File *.env* must exist in project root for utility to work. Look *.env.example* file for example. **FILES_CONFIG** field references JSON file containing array of files to backup (Look up *files.json.example* for reference).

**PASSWORD** - used for encryption of the files
**IPFS_CLIENT_URL** - IPFS node api endpoint - default is *http://127.0.0.1:5001*

### NPM run scripts

First run `npm install` as usual.

- `npm run sync` - syncs file with ipfs. Files not found locally are either skipped if no entry exists in database, or they are decrypted from IPFS and then saved. Changed files are updated on IPFS and entry saved to database.
- `npm run clean-db` - unpins all backups from IPFS and deletes db.json

Database is actually *db.json* and it containes all entries backed up encrpyted on IPFS, along with some data used for encryption.
Do not share or publish publicly *.env* and *db.json* files!
