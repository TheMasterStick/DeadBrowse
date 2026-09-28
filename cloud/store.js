export class ConflictError extends Error {}
export function emptyWorld() {
  return { players: {}, encounters: {}, enemies: {} };
}
export async function transact(db, operation) {
  await db
    .prepare(
      "INSERT OR IGNORE INTO hosted_world(id,revision,payload) VALUES(1,0,?)",
    )
    .bind(JSON.stringify(emptyWorld()))
    .run();
  for (let attempt = 0; attempt < 8; attempt++) {
    const row = await db
      .prepare("SELECT revision,payload FROM hosted_world WHERE id=1")
      .first();
    const world = JSON.parse(row.payload);
    const result = operation(world);
    const payload = JSON.stringify(world);
    if (payload === row.payload) return result;
    const written = await db
      .prepare(
        "UPDATE hosted_world SET payload=?,revision=revision+1 WHERE id=1 AND revision=?",
      )
      .bind(payload, row.revision)
      .run();
    if (written.meta.changes === 1) return result;
  }
  throw new ConflictError("The district is busy. Please try again.");
}
