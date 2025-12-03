import AccessPolicy from "../models/accessPolicyModel.js";
import Contract from "../models/contractModel.js";
import Client from "../models/clientModel.js";

export const ensureDefaultAccessPolicyForBuilding = async (buildingId, { effectiveFrom, effectiveTo, description } = {}) => {
  if (!buildingId) return { created: false, updated: false, policy: null };

  let policy = await AccessPolicy.findOne({ buildingId, isDefaultForBuilding: true });
  if (policy) {
    let updated = false;
    const newFrom = effectiveFrom ? new Date(effectiveFrom) : (policy.effectiveFrom || null);
    const newTo = effectiveTo ? new Date(effectiveTo) : (policy.effectiveTo || null);

    // Widen window only if provided
    if (newFrom && (!policy.effectiveFrom || newFrom < policy.effectiveFrom)) {
      policy.effectiveFrom = newFrom;
      updated = true;
    }
    if (newTo && (!policy.effectiveTo || newTo > policy.effectiveTo)) {
      policy.effectiveTo = newTo;
      updated = true;
    }
    if (description && description !== policy.description) {
      policy.description = description;
      updated = true;
    }

    if (updated) {
      await policy.save();
      return { created: false, updated: true, policy };
    }
    return { created: false, updated: false, policy };
  }

  // Create a sensible default policy (building-scoped)
  policy = await AccessPolicy.create({
    buildingId,
    name: "Default Access",
    description: description || "Automatically created on contract activation",
    accessPointIds: [],
    isDefaultForBuilding: true,
    ...(effectiveFrom ? { effectiveFrom: new Date(effectiveFrom) } : {}),
    ...(effectiveTo ? { effectiveTo: new Date(effectiveTo) } : {}),
  });

  return { created: true, updated: false, policy };
};

export const ensureDefaultAccessPolicyForContract = async (contractOrId) => {
  let contract = contractOrId;
  if (!contract || !contract._id) {
    contract = await Contract.findById(contractOrId);
  }
  if (!contract) return { created: false, updated: false, policy: null };

  const clientId = contract.client || contract.clientId;
  let buildingId = null;
  if (clientId) {
    const cli = await Client.findById(clientId).select('building').lean();
    buildingId = cli?.building || null;
  }
  const effectiveFrom = contract.startDate || contract.commencementDate || new Date();
  const effectiveTo = contract.endDate || null;
  const description = `Default policy for building ${String(buildingId)} created on contract activation (${contract._id})`;

  return ensureDefaultAccessPolicyForBuilding(buildingId, { effectiveFrom, effectiveTo, description });
};

export default {
  ensureDefaultAccessPolicyForBuilding,
  ensureDefaultAccessPolicyForContract,
};
