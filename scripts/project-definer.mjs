import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Utility: timestamp
function nowIso() {
  return new Date().toISOString();
}

// Resolve __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const MODELS_DIR = path.join(rootDir, 'models');
const ROUTES_DIR = path.join(rootDir, 'routes');
const CONTROLLERS_DIR = path.join(rootDir, 'controllers');
const API_ROUTES_FILE = path.join(ROUTES_DIR, 'api.js');

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return '';
  }
}

function listFiles(dir, filter = (f) => true) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile() && filter(d.name))
      .map((d) => path.join(dir, d.name));
  } catch (e) {
    return [];
  }
}

// Naive pluralize for collection name if not explicitly set
function naivePluralize(modelName) {
  if (!modelName) return null;
  const lower = modelName.toLowerCase();
  if (lower.endsWith('s')) return lower;
  if (lower.endsWith('y')) return lower.slice(0, -1) + 'ies';
  if (lower.endsWith('x') || lower.endsWith('ch') || lower.endsWith('sh')) return lower + 'es';
  return lower + 's';
}

// Extract model info from a model file's source
function extractModelInfo(modelFilePath) {
  const src = safeRead(modelFilePath);
  const relFile = path.relative(rootDir, modelFilePath).replaceAll('\\', '/');

  // Try to find model name from mongoose.model("Name", ...)
  const modelMatch = src.match(/mongoose\.model\(\s*["'`]([^"'`]+)["'`]/);
  const modelName = modelMatch?.[1] || null;

  // Try to find explicit collection option inside Schema options
  // Looks for: collection: "name"
  const collectionMatch = src.match(/collection\s*:\s*["'`]([^"'`]+)["'`]/);
  const collection = collectionMatch?.[1] || naivePluralize(modelName);

  return {
    file: relFile,
    modelName,
    collection,
  };
}

// Build map of model alias -> model file and canonical model info, by scanning controllers' imports
function scanControllersForModelImports() {
  const controllers = listFiles(CONTROLLERS_DIR, (n) => n.endsWith('.js'));
  const map = {}; // controllerRelPath -> { modelsUsed: Set<modelRelPath>, modelAliases: Map<alias, modelRelPath> }

  for (const file of controllers) {
    const src = safeRead(file);
    const rel = path.relative(rootDir, file).replaceAll('\\', '/');

    // import Something from "../models/fooModel.js";
    // import { A, B as Alias } from "../models/fooModel.js";
    // import * as Foo from "../models/fooModel.js";
    const importRegex = /import\s+([^;]+?)\s+from\s+["'](..\/models\/[^"']+)["'];/g;
    let m;
    const modelsUsed = new Set();
    const modelAliases = new Map();
    while ((m = importRegex.exec(src))) {
      const bindings = m[1].trim();
      const importPath = m[2];
      const absModelPath = path.resolve(path.dirname(file), importPath);
      const relModelPath = path.relative(rootDir, absModelPath).replaceAll('\\', '/');
      modelsUsed.add(relModelPath);

      // Parse bindings for alias names
      // default import: Foo
      const defaultMatch = bindings.match(/^([A-Za-z_$][\w$]*)$/);
      if (defaultMatch) {
        modelAliases.set(defaultMatch[1], relModelPath);
      }

      // namespace import: * as Foo
      const nsMatch = bindings.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (nsMatch) {
        modelAliases.set(nsMatch[1], relModelPath);
      }

      // named imports: { A, B as C }
      const namedMatch = bindings.match(/^\{([\s\S]+)\}$/);
      if (namedMatch) {
        const parts = namedMatch[1]
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean);
        for (const p of parts) {
          const asMatch = p.match(/^([A-Za-z_$][\w$]*)(\s+as\s+([A-Za-z_$][\w$]*))?$/);
          if (asMatch) {
            const alias = asMatch[3] || asMatch[1];
            modelAliases.set(alias, relModelPath);
          }
        }
      }
    }

    map[rel] = { modelsUsed, modelAliases };
  }

  return map;
}

// Parse routes/api.js to map import var -> route base path and file
function parseApiMounts() {
  const src = safeRead(API_ROUTES_FILE);
  const dir = path.dirname(API_ROUTES_FILE);

  // import x from "./buildings.js";
  const importMap = new Map(); // varName -> absPath
  const importRegex = /import\s+([A-Za-z_$][\w$]*)\s+from\s+["']\.\/(.+?)\.js["'];/g;
  let m;
  while ((m = importRegex.exec(src))) {
    const varName = m[1];
    const fileBase = m[2];
    const abs = path.join(dir, `${fileBase}.js`);
    importMap.set(varName, abs);
  }

  // router.use("/buildings", buildingsRoutes);
  const mounts = {}; // relRouteFile -> basePath
  const useRegex = /router\.use\(\s*["'`]([^"'`]+)["'`]\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g;
  while ((m = useRegex.exec(src))) {
    const basePath = m[1];
    const varName = m[2];
    const abs = importMap.get(varName);
    if (!abs) continue;
    const rel = path.relative(rootDir, abs).replaceAll('\\', '/');
    mounts[rel] = basePath;
  }
  return mounts;
}

// Extract route definitions from a routes/*.js file
function extractRoutesFromFile(routeFilePath) {
  const src = safeRead(routeFilePath);
  const rel = path.relative(rootDir, routeFilePath).replaceAll('\\', '/');

  const results = [];
  // Matches: router.get('/path', handler)
  const simpleRegex = /router\.(get|post|put|delete|patch|options|head|all)\s*\(\s*["'`]([^"'`]+)["'`]/g;
  let m;
  while ((m = simpleRegex.exec(src))) {
    const method = m[1].toUpperCase();
    const subPath = m[2];
    results.push({ method, subPath, file: rel });
  }

  // Matches: router.route('/path').get(handler).post(handler)
  const routeChainRegex = /router\.route\(\s*["'`]([^"'`]+)["'`]\s*\)\.([A-Za-z.]+)/g;
  while ((m = routeChainRegex.exec(src))) {
    const subPath = m[1];
    const chain = m[2];
    const methods = chain.split('.').map((s) => s.trim()).filter(Boolean);
    for (const mm of methods) {
      const method = mm.toUpperCase();
      if (['GET','POST','PUT','DELETE','PATCH','OPTIONS','HEAD','ALL'].includes(method)) {
        results.push({ method, subPath, file: rel });
      }
    }
  }

  // Collect controller imports from this route file
  const controllerImports = [];
  const importCtrlRegex = /import\s+([^;]+?)\s+from\s+["'](..\/controllers\/[^"']+)["'];/g;
  while ((m = importCtrlRegex.exec(src))) {
    const importPath = m[2];
    const abs = path.resolve(path.dirname(routeFilePath), importPath);
    controllerImports.push(path.relative(rootDir, abs).replaceAll('\\', '/'));
  }

  // Attempt to collect handler identifiers used in router.* calls
  const handlerRegex = /router\.(?:get|post|put|delete|patch|options|head|all)\s*\(\s*["'`][^"'`]+["'`]\s*,\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)/g;
  const handlers = new Set();
  let h;
  while ((h = handlerRegex.exec(src))) {
    handlers.add(h[1]);
  }

  return { routes: results, controllerImports, handlers: Array.from(handlers) };
}

function main() {
  // 1) Models
  const modelFiles = listFiles(MODELS_DIR, (n) => n.endsWith('.js'));
  const models = modelFiles.map(extractModelInfo);
  const modelsByFile = new Map(models.map((m) => [m.file, m]));

  // 2) Controllers -> models used
  const controllerModelMap = scanControllersForModelImports();

  // 3) API mounts
  const apiMounts = parseApiMounts();

  // 4) Route files
  const routeFiles = listFiles(ROUTES_DIR, (n) => n.endsWith('.js'))
    .filter((f) => path.basename(f) !== 'api.js');

  const routeEntries = [];
  for (const rf of routeFiles) {
    const rel = path.relative(rootDir, rf).replaceAll('\\', '/');
    const basePath = apiMounts[rel] || '(unmounted)';
    const { routes, controllerImports, handlers } = extractRoutesFromFile(rf);

    // Determine associated models via controller imports
    const associatedModels = new Set();
    for (const ctrlRel of controllerImports) {
      const info = controllerModelMap[ctrlRel];
      if (info) {
        for (const modelRel of info.modelsUsed) {
          const modelInfo = modelsByFile.get(modelRel);
          if (modelInfo?.modelName) {
            associatedModels.add(modelInfo.modelName);
          } else if (modelInfo) {
            associatedModels.add(path.basename(modelRel));
          }
        }
      }
    }

    const enrichedRoutes = routes.map((r) => {
      let fullPath = r.subPath;
      if (basePath && basePath !== '(unmounted)') {
        fullPath = r.subPath.startsWith('/')
          ? `${basePath}${r.subPath}`
          : `${basePath}/${r.subPath}`;
      }
      return {
        ...r,
        basePath,
        fullPath,
      };
    });

    routeEntries.push({
      file: rel,
      basePath,
      controllers: controllerImports,
      handlers,
      models: Array.from(associatedModels).sort(),
      routes: enrichedRoutes,
    });
  }

  // Output JSON summary to console
  const summary = {
    generatedAt: nowIso(),
    root: path.basename(rootDir),
    counts: {
      models: models.length,
      routes: routeEntries.reduce((acc, r) => acc + r.routes.length, 0),
      routeFiles: routeEntries.length,
    },
    models,
    routeGroups: routeEntries,
  };

  console.log(JSON.stringify(summary, null, 2));

  // Also write a readable Markdown document
  const md = [];
  md.push(`# Project Definition for ${path.basename(rootDir)}`);
  md.push("");
  md.push(`Generated at: ${nowIso()}`);
  md.push("");
  md.push(`- Total Models: ${models.length}`);
  md.push(`- Total Route Files: ${routeEntries.length}`);
  md.push(`- Total Endpoints: ${summary.counts.routes}`);
  md.push("");

  // Models table
  md.push(`## Collections / Models`);
  md.push("");
  md.push(`Model | Collection | File`);
  md.push(`--- | --- | ---`);
  for (const m of models.sort((a,b) => (a.modelName||'').localeCompare(b.modelName||''))) {
    md.push(`${m.modelName || '(unknown)'} | ${m.collection || '(unknown)'} | \`${m.file}\``);
  }
  md.push("");

  // Routes
  md.push(`## Routes`);
  md.push("");

  for (const group of routeEntries.sort((a,b) => a.basePath.localeCompare(b.basePath))) {
    md.push(`### ${group.basePath} — \`${group.file}\``);
    if (group.models?.length) {
      md.push(`Models: ${group.models.join(', ')}`);
    }
    if (group.controllers?.length) {
      md.push(`Controllers: ${group.controllers.map((c) => `\`${c}\``).join(', ')}`);
    }
    md.push("");
    md.push(`Method | Path`);
    md.push(`--- | ---`);
    for (const r of group.routes.sort((a,b) => a.fullPath.localeCompare(b.fullPath) || a.method.localeCompare(b.method))) {
      md.push(`${r.method} | \`${r.fullPath}\``);
    }
    md.push("");
  }

  const outPath = path.join(rootDir, 'PROJECT_DEFINITION.md');
  fs.writeFileSync(outPath, md.join('\n'), 'utf8');
  console.error(`\nWrote ${outPath}`);
}

main();
