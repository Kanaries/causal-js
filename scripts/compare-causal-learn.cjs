#!/usr/bin/env node

const { main } = require("./parity/run-parity.cjs");

main(["--profile", "full", ...process.argv.slice(2)]);
