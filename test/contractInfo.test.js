const { expect } = require("chai");
const fs = require("fs");
const hre = require("hardhat");
const { build, OUT } = require("../scripts/export-abi");

describe("packages/shared/src/contract.json", () => {
  it("is up to date with the compiled contract (run `npm run export:abi` if this fails)", async function () {
    // solidity-coverage compiles an instrumented copy of the contracts, whose layout is not the real one
    if (hre.__SOLIDITY_COVERAGE_RUNNING) this.skip();
    const committed = JSON.parse(fs.readFileSync(OUT, "utf8"));
    const fresh = JSON.parse(JSON.stringify(await build(hre)));
    expect(committed).to.deep.equal(fresh);
  });
});
