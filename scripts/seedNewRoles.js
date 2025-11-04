import mongoose from "mongoose";
import Role from "../models/roleModel.js";
import { ROLE_PERMISSIONS } from "../constants/permissions.js";

// New role definitions for updated onboarding flow
const newRoles = [
  {
    roleName: "Sales",
    description: "Sales team - Creates clients and draft contracts, submits to Legal for review",
    permissions: ROLE_PERMISSIONS.sales,
    canLogin: true,
  },
  {
    roleName: "Legal Team",
    description: "Legal team - Reviews contracts, drafts agreements, sends to Admin for approval, manages Zoho Sign",
    permissions: ROLE_PERMISSIONS.legal_team,
    canLogin: true,
  },
  {
    roleName: "Senior Management",
    description: "Senior Management (Admin) - Approves/rejects contracts, final onboarding approval, full oversight",
    permissions: ROLE_PERMISSIONS.senior_management,
    canLogin: true,
  },
  {
    roleName: "Finance Senior",
    description: "Finance Senior - Manages invoices, payments, financial operations, contract coordination",
    permissions: ROLE_PERMISSIONS.finance_senior,
    canLogin: true,
  },
  {
    roleName: "Operations Senior",
    description: "Operations Senior - Post-approval setup, access provisioning, inventory management, team supervision",
    permissions: ROLE_PERMISSIONS.operations_senior,
    canLogin: true,
  },
  {
    roleName: "Operations Junior",
    description: "Operations Junior - Day-to-day operations, member support, access management, ticket handling",
    permissions: ROLE_PERMISSIONS.operations_junior,
    canLogin: true,
  },
  {
    roleName: "Community Senior",
    description: "Community Senior - Event management, member engagement, booking coordination, team leadership",
    permissions: ROLE_PERMISSIONS.community_senior,
    canLogin: true,
  },
  {
    roleName: "Community Junior",
    description: "Community Junior - Member support, event assistance, booking management, basic ticket handling",
    permissions: ROLE_PERMISSIONS.community_junior,
    canLogin: true,
  },
  {
    roleName: "System Admin",
    description: "System Admin - Full system access, all permissions",
    permissions: ROLE_PERMISSIONS.system_admin,
    canLogin: true,
  },
];

async function seedNewRoles() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGO_URI || "mongodb+srv://nasir-flyde:Nsa%4019786@ofis-square-db.xaajgtt.mongodb.net/test";
    await mongoose.connect(mongoUri);
    console.log("✅ Connected to MongoDB");
    console.log("─────────────────────────────────────────────────────────\n");

    let created = 0;
    let updated = 0;
    let skipped = 0;

    // Insert or update roles
    for (const roleData of newRoles) {
      const existing = await Role.findOne({ roleName: roleData.roleName });
      
      if (existing) {
        // Update existing role with new permissions
        await Role.findByIdAndUpdate(existing._id, {
          description: roleData.description,
          permissions: roleData.permissions,
          canLogin: roleData.canLogin,
        });
        console.log(`🔄 Updated: ${roleData.roleName} (${roleData.permissions.length} permissions)`);
        updated++;
      } else {
        // Create new role
        await Role.create(roleData);
        console.log(`✨ Created: ${roleData.roleName} (${roleData.permissions.length} permissions)`);
        created++;
      }
    }

    console.log("\n─────────────────────────────────────────────────────────");
    console.log("✅ Role seeding completed successfully!");
    console.log(`   Created: ${created} | Updated: ${updated} | Total: ${newRoles.length}`);

    // Display all roles with permission counts
    console.log("\n📋 Roles Summary:");
    console.log("─────────────────────────────────────────────────────────");
    for (const role of newRoles) {
      const permCount = role.permissions.length;
      const icon = role.roleName === "System Admin" ? "👑" : 
                   role.roleName.includes("Senior") ? "⭐" : 
                   role.roleName.includes("Legal") ? "⚖️" : 
                   role.roleName.includes("Sales") ? "💼" : 
                   role.roleName.includes("Finance") ? "💰" : 
                   role.roleName.includes("Operations") ? "⚙️" : 
                   role.roleName.includes("Community") ? "👥" : "📌";
      console.log(`${icon} ${role.roleName.padEnd(25)} - ${permCount.toString().padStart(3)} permissions`);
    }

    // Display detailed permission breakdown
    console.log("\n📝 Detailed Permission Breakdown:");
    console.log("─────────────────────────────────────────────────────────");
    for (const role of newRoles) {
      console.log(`\n${role.roleName}:`);
      console.log(`Description: ${role.description}`);
      console.log(`Permissions (${role.permissions.length}):`);
      
      // Group permissions by category
      const grouped = {};
      role.permissions.forEach(perm => {
        if (perm === "*:*") {
          grouped["SYSTEM"] = grouped["SYSTEM"] || [];
          grouped["SYSTEM"].push(perm);
        } else {
          const [resource] = perm.split(":");
          grouped[resource.toUpperCase()] = grouped[resource.toUpperCase()] || [];
          grouped[resource.toUpperCase()].push(perm);
        }
      });
      
      Object.keys(grouped).sort().forEach(category => {
        console.log(`  ${category}:`);
        grouped[category].forEach(perm => console.log(`    • ${perm}`));
      });
    }

    await mongoose.connection.close();
    console.log("\n✅ Database connection closed");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Error seeding roles:", error);
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
    process.exit(1);
  }
}

// Run the seed function
seedNewRoles();
