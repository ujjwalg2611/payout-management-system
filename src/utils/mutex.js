/**
 * Per-key mutex.
 *
 * WHY THIS EXISTS:
 * Two operations can race on the same user's wallet balance at the same time
 * - e.g. the advance-payout cron job and a manual withdrawal request hitting
 * the same user within the same millisecond. Node.js is single-threaded so a
 * naive read-modify-write ("read balance -> compute new balance -> write")
 * is NOT atomic across an `await` boundary and can lose updates.
 *
 * In this in-memory demo we serialize all wallet-affecting operations per
 * userId with a promise chain. In a real relational DB, this same guarantee
 * is achieved with `SELECT ... FOR UPDATE` inside a transaction (see
 * db/schema.sql comments) - the mutex here is a faithful stand-in for that.
 */
class KeyedMutex {
  constructor() {
    this._chains = new Map();
  }

  async runExclusive(key, fn) {
    const previous = this._chains.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => (release = resolve));
    this._chains.set(key, previous.then(() => current));

    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this._chains.get(key) === current) {
        this._chains.delete(key);
      }
    }
  }
}

module.exports = new KeyedMutex();
