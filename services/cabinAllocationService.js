import Cabin from "../models/cabinModel.js";
import Contract from "../models/contractModel.js";

/**
 * Allocate all cabins that are currently blocked for the contract's client in the same building
 * when the contract becomes active (signed).
 *
 * Rules:
 * - Consider cabins in the same building with status in [blocked, available]
 * - Consider blocks where blocks.status === 'active' and blocks.client === contract.client
 * - Prefer blocks linked to this contract (block.contract === contractId) if present
 * - Date range check: today must be within [fromDate, toDate] for the block (inclusive)
 * - Allocation sets cabin.status = 'occupied', allocatedTo = client, contract = contractId, allocatedAt = now
 * - The chosen block's status becomes 'allocated' with updatedAt = now
 *
 * Returns results summary with details per-cabin.
 */
export async function allocateBlockedCabinsForContract(contractId) {
  const results = { processed: 0, allocated: 0, skipped: 0, errors: 0, details: [] };
  try {
    const contract = await Contract.findById(contractId);
    if (!contract) return results;

    const today = new Date();

    // Day-based inclusive range check to avoid timezone boundary issues
    const inRange = (blk) => {
      try {
        if (!blk?.fromDate || !blk?.toDate) return true; // if dates missing, be lenient
        const from = new Date(blk.fromDate);
        const to = new Date(blk.toDate);
        // Expand to full-day boundaries in server local time
        from.setHours(0, 0, 0, 0);
        to.setHours(23, 59, 59, 999);
        const now = new Date();
        return now >= from && now <= to;
      } catch {
        return true;
      }
    };
    const cabins = await Cabin.find({
      building: contract.building,
      status: { $in: ["blocked", "available"] },
      "blocks.status": "active",
      "blocks.client": contract.client,
    });

    for (const cabin of cabins) {
      results.processed++;
      try {
        const activeBlocks = (cabin.blocks || []).filter(
          (b) => b.status === "active" && String(b.client) === String(contract.client) && inRange(b)
        );
        if (activeBlocks.length === 0) {
          results.skipped++;
          results.details.push({ cabinId: cabin._id, action: "skipped", reason: "no_active_block" });
          continue;
        }

        // Prefer a block that is already linked to this contract
        let chosen = activeBlocks.find((b) => String(b.contract) === String(contract._id));
        if (!chosen) chosen = activeBlocks[0];

        if (!["blocked", "available"].includes(cabin.status)) {
          results.skipped++;
          results.details.push({ cabinId: cabin._id, action: "skipped", reason: `status_${cabin.status}` });
          continue;
        }

        // Allocate
        cabin.status = "occupied";
        cabin.allocatedTo = contract.client;
        cabin.contract = contract._id;
        cabin.allocatedAt = new Date();

        if (chosen) {
          chosen.status = "allocated";
          chosen.updatedAt = new Date();
          // ensure block has contract reference
          if (!chosen.contract) chosen.contract = contract._id;
        }

        await cabin.save();
        results.allocated++;
        results.details.push({ cabinId: cabin._id, blockId: chosen?._id, action: "allocated" });
      } catch (e) {
        results.errors++;
        results.details.push({ cabinId: cabin._id, action: "error", error: e.message });
      }
    }
  } catch (err) {
    results.errors++;
    results.details.push({ action: "error", error: err.message });
  }
  return results;
}
