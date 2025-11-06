import mongoose from "mongoose";
import Role from "../models/roleModel.js";
import { ROLE_PERMISSIONS } from "../constants/permissions.js";

// Role definitions
const roles = [
  {
    roleName: "Contract Creator",
    description: "Creates and manages contracts. Can create, edit, and submit contracts for approval.",
    permissions: ROLE_PERMISSIONS.contract_creator,
    canLogin: true,
  },
  {
    roleName: "Approver / Finance Admin",
    description: "Approves contracts and invoices. Can approve/reject contracts, manage invoices, and auto-approve own contracts.",
    permissions: ROLE_PERMISSIONS.approver,
    canLogin: true,
  },
  {
    roleName: "Billing Admin",
    description: "Handles invoicing, payments, and late fee management. Can generate invoices, apply late fees, and process payments.",
    permissions: ROLE_PERMISSIONS.billing_admin,
    canLogin: true,
  },
  {
    roleName: "Operations Admin",
    description: "Handles day-to-day admin functions. Can monitor transactions, manage clients, and generate reports.",
    permissions: ROLE_PERMISSIONS.operations_admin,
    canLogin: true,
  },
  {
    roleName: "System Admin",
    description: "Has full system-level access. Can manage users, roles, integrations, and has all permissions.",
    permissions: ROLE_PERMISSIONS.system_admin,
    canLogin: true,
  },
];

async function seedRoles() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGO_URI || "mongodb://localhost:27017/ofis-square";
    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB");

    // Clear existing roles (optional - comment out if you want to keep existing roles)
    // await Role.deleteMany({});
    // console.log("Cleared existing roles");

    // Insert roles
    for (const roleData of roles) {
      const existing = await Role.findOne({ roleName: roleData.roleName });
      
      if (existing) {
        // Update existing role with new permissions
        await Role.findByIdAndUpdate(existing._id, {
          description: roleData.description,
          permissions: roleData.permissions,
          canLogin: roleData.canLogin,
        });
        console.log(`✓ Updated role: ${roleData.roleName} (${roleData.permissions.length} permissions)`);
      } else {
        // Create new role
        await Role.create(roleData);
        console.log(`✓ Created role: ${roleData.roleName} (${roleData.permissions.length} permissions)`);
      }
    }

    console.log("\n✅ Role seeding completed successfully!");
    console.log("\nRoles created:");
    roles.forEach((role, index) => {
      console.log(`${index + 1}. ${role.roleName} - ${role.permissions.length} permissions`);
    });

    // Display permission breakdown
    console.log("\n📋 Permission Breakdown:");
    console.log("─────────────────────────────────────────────────────────");
    for (const role of roles) {
      console.log(`\n${role.roleName}:`);
      role.permissions.forEach(perm => console.log(`  • ${perm}`));
    }

    await mongoose.connection.close();
    console.log("\n✅ Database connection closed");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error seeding roles:", error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run the seed function
seedRoles();
