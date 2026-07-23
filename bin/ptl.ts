#!/usr/bin/env bun

const args = process.argv.slice(2);

if (args[0] === "check") {
  console.log("ptl check — not implemented yet");
} else if (args[0] === "translate") {
  console.log("ptl translate — not implemented yet");
} else {
  console.log("Usage: ptl <translate|check> [options]");
}
