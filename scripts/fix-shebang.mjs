import fs from "node:fs";

const path = new URL("../dist/index.js", import.meta.url);
const file = fs.readFileSync(path, "utf-8");
const lines = file.split("\n");
if (lines[0].startsWith("#!")) {
  lines[0] = "#!/usr/bin/env node";
} else {
  lines.unshift("#!/usr/bin/env node");
}
fs.writeFileSync(path, lines.join("\n"));
