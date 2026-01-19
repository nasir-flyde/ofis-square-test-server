/**
 * REAL Project Definer (Express + Mongoose)
 * Works with non-standard folder structures
 */

const fs = require("fs");
const path = require("path");

let parser, traverse;
try {
  parser = require("@babel/parser");
  traverse = require("@babel/traverse").default;
} catch {
  console.error("Run: npm install @babel/parser @babel/traverse");
  process.exit(1);
}

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, "PROJECT_DEFINITION.md");

const result = {
  collections: new Set(),
  models: [],
  routes: []
};

/* -------------------- FS Utils -------------------- */

function walk(dir, filelist = []) {
  fs.readdirSync(dir).forEach(file => {
    const filepath = path.join(dir, file);
    if (fs.statSync(filepath).isDirectory()) {
      if (!["node_modules", ".git"].includes(file)) {
        walk(filepath, filelist);
      }
    } else if (file.endsWith(".js") || file.endsWith(".cjs")) {
      filelist.push(filepath);
    }
  });
  return filelist;
}

function parseFile(file) {
  return parser.parse(fs.readFileSync(file, "utf8"), {
    sourceType: "unambiguous"
  });
}

/* -------------------- Analyzer -------------------- */

function analyzeFile(file) {
  const ast = parseFile(file);

  traverse(ast, {
    // mongoose.model(...)
    CallExpression(p) {
      const callee = p.node.callee;

      if (callee.property?.name === "model") {
        const model = p.node.arguments[0]?.value;
        const collection =
          p.node.arguments[2]?.value || model?.toLowerCase();

        if (model) {
          result.models.push({
            model,
            collection,
            file: path.relative(ROOT, file)
          });
          result.collections.add(collection);
        }
      }

      // express.Router().get("/x")
      if (
        ["get", "post", "put", "delete", "patch"].includes(
          callee.property?.name
        )
      ) {
        const route = p.node.arguments[0]?.value;
        if (route) {
          result.routes.push({
            method: callee.property.name.toUpperCase(),
            path: route,
            file: path.relative(ROOT, file)
          });
        }
      }
    },

    // new mongoose.Schema({},{collection:"x"})
    NewExpression(p) {
      if (
        p.node.callee.property?.name === "Schema" &&
        p.node.arguments[1]?.properties
      ) {
        p.node.arguments[1].properties.forEach(prop => {
          if (prop.key.name === "collection") {
            result.collections.add(prop.value.value);
          }
        });
      }
    }
  });
}

/* -------------------- Run -------------------- */

console.log("🔍 Scanning entire project...");

walk(ROOT).forEach(analyzeFile);

/* -------------------- Output -------------------- */

let md = `# 📘 Project Definition Document\n\n`;

md += `## 📦 Collections\n`;
[...result.collections].forEach(c => (md += `- ${c}\n`));

md += `\n## 🧩 Models\n`;
result.models.forEach(m => {
  md += `- **${m.model}** → \`${m.collection}\`  \n  _${m.file}_\n`;
});

md += `\n## 🛣️ Routes\n`;
result.routes.forEach(r => {
  md += `- **${r.method}** ${r.path}  \n  _${r.file}_\n`;
});

fs.writeFileSync(OUTPUT, md);

console.log("✅ Done");
console.log(`📄 ${OUTPUT}`);
