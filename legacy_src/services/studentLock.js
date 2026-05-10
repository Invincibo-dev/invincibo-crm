const SERIALIZE_ALL_WRITES = (process.env.DB_DIALECT || "mysql") === "sqlite";
const queues = new Map();

const withStudentLock = (studentKey, task) => {
  const key = SERIALIZE_ALL_WRITES ? "__sqlite_global_write_lock__" : String(studentKey);
  const previous = queues.get(key) || Promise.resolve();

  const run = previous.then(() => task(), () => task());
  const nextQueue = run.catch(() => undefined);

  queues.set(
    key,
    nextQueue.finally(() => {
      if (queues.get(key) === nextQueue) {
        queues.delete(key);
      }
    })
  );

  return run;
};

module.exports = {
  withStudentLock
};
