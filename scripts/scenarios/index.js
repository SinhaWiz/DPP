const { makeContext } = require("./context");

const scenarios = [
  require("./supplyChain"),
  require("./escrowRevocations"),
  require("./everyError"),
  require("./pendingReplacement"),
  require("./bulk"),
];
const byName = Object.fromEntries(scenarios.map((s) => [s.name, s]));

/** Runs one scenario by name. */
async function runScenario(name, deps, options) {
  const scenario = byName[name];
  if (!scenario) throw new Error(`Unknown scenario '${name}'. Known: ${Object.keys(byName).join(", ")}`);
  return scenario.run(makeContext(deps), options);
}

module.exports = { scenarios, byName, runScenario, makeContext };
