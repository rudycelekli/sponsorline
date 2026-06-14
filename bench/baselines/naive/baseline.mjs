// B1: folk implementation — Math.random selection, no consent, no witness, no replay.
export function naivePick(inventory) {
  const i = Math.floor(Math.random() * inventory.length);
  return { winnerId: inventory[i].id, clearingPriceCents: inventory[i].bidCents, reproducible: false };
}
