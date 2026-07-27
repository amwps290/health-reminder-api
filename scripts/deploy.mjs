import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workerDirectory = join(projectRoot, "worker");
const sourceConfigPath = join(workerDirectory, "wrangler.jsonc");
const deployConfigPath = join(workerDirectory, "wrangler.deploy.jsonc");
const databaseName = "health-reminder";
const databaseBinding = "DB";
const placeholderDatabaseId = "00000000-0000-0000-0000-000000000000";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function runWrangler(arguments_, captureOutput = false) {
  const corepack = process.platform === "win32" ? "corepack.cmd" : "corepack";
  const result = spawnSync(
    corepack,
    ["pnpm", "--dir", workerDirectory, "exec", "wrangler", ...arguments_],
    {
      cwd: projectRoot,
      encoding: captureOutput ? "utf8" : undefined,
      stdio: captureOutput ? ["inherit", "pipe", "inherit"] : "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Wrangler command failed: wrangler ${arguments_.join(" ")}`);
  }
  return captureOutput ? result.stdout : "";
}

function parseDatabaseList(output) {
  const parsed = JSON.parse(output.trim());
  const databases = Array.isArray(parsed)
    ? parsed
    : parsed.result || parsed.databases || [];
  if (!Array.isArray(databases)) throw new Error("Wrangler returned an invalid D1 database list");
  return databases.map((database) => ({
    name: database.name || database.database_name,
    id: database.uuid || database.id || database.database_id,
  }));
}

function listDatabases() {
  return parseDatabaseList(runWrangler(["d1", "list", "--json"], true));
}

function findDatabaseId(databases) {
  const matches = databases.filter((database) => database.name === databaseName);
  if (matches.length > 1) {
    throw new Error(`Multiple D1 databases are named ${databaseName}; remove or rename duplicates`);
  }
  const id = matches[0]?.id;
  if (!id) return null;
  if (!uuidPattern.test(id)) throw new Error(`D1 database ${databaseName} returned an invalid ID`);
  return id;
}

function findCreatedDatabaseId(output) {
  const match = output.match(/database_id["']?\s*[=:]\s*["']?([0-9a-f-]{36})["']?/i);
  const id = match?.[1] || null;
  if (id && !uuidPattern.test(id)) throw new Error(`D1 database ${databaseName} returned an invalid ID`);
  return id;
}

function resolveDatabaseId() {
  let id = findDatabaseId(listDatabases());
  if (id) return id;

  console.log(`D1 database ${databaseName} was not found; creating it now.`);
  const createOutput = runWrangler(["d1", "create", databaseName], true);
  process.stdout.write(createOutput);
  id = findCreatedDatabaseId(createOutput);
  if (id) return id;
  id = findDatabaseId(listDatabases());
  if (!id) throw new Error(`D1 database ${databaseName} was created but could not be resolved`);
  return id;
}

function createDeployConfig(source, databaseId) {
  if (!uuidPattern.test(databaseId) || databaseId === placeholderDatabaseId) {
    throw new Error("Refusing to deploy with an invalid or placeholder D1 database ID");
  }
  const config = JSON.parse(source);
  const binding = config.d1_databases?.find((database) => database.binding === databaseBinding);
  if (!binding) throw new Error(`Wrangler config is missing the ${databaseBinding} D1 binding`);
  if (binding.database_name !== databaseName) {
    throw new Error(`The ${databaseBinding} binding must use the ${databaseName} database name`);
  }
  binding.database_id = databaseId;
  return `${JSON.stringify(config, null, 2)}\n`;
}

function selfTest() {
  const fixtureId = "11111111-2222-4333-8444-555555555555";
  assert.equal(findDatabaseId(parseDatabaseList(JSON.stringify([{ name: databaseName, uuid: fixtureId }]))), fixtureId);
  assert.equal(findDatabaseId(parseDatabaseList(JSON.stringify({ result: [] }))), null);
  assert.equal(findCreatedDatabaseId(`database_id = "${fixtureId}"`), fixtureId);
  assert.throws(() => createDeployConfig(readFileSync(sourceConfigPath, "utf8"), placeholderDatabaseId));
  const rendered = JSON.parse(createDeployConfig(readFileSync(sourceConfigPath, "utf8"), fixtureId));
  assert.equal(rendered.d1_databases[0].database_id, fixtureId);
  console.log("Deploy configuration self-test passed.");
}

function deploy() {
  const source = readFileSync(sourceConfigPath, "utf8");
  const sourceConfig = JSON.parse(source);
  const configuredId = sourceConfig.d1_databases?.find(
    (database) => database.binding === databaseBinding,
  )?.database_id;
  const databaseId = configuredId && configuredId !== placeholderDatabaseId
    ? configuredId
    : resolveDatabaseId();

  writeFileSync(deployConfigPath, createDeployConfig(source, databaseId), { flag: "w" });
  try {
    console.log(`Applying D1 migrations to ${databaseName}.`);
    runWrangler(["d1", "migrations", "apply", databaseBinding, "--remote", "--config", "wrangler.deploy.jsonc"]);
    console.log("Deploying Worker and static assets.");
    runWrangler(["deploy", "--config", "wrangler.deploy.jsonc"]);
  } finally {
    try {
      unlinkSync(deployConfigPath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

try {
  if (process.argv.includes("--self-test")) selfTest();
  else deploy();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
