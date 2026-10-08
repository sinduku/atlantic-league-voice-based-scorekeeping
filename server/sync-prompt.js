// Copies the prompt from prompt.js into the Supabase edge function, which runs
// on Deno and cannot import this CommonJS code. Run after changing the prompt
// or phrasings.js:
//
//   npm run sync:prompt
//
// prompt.test.js fails while the two are out of step.

const fs = require("node:fs");
const path = require("node:path");
const { buildStaticPrompt } = require("./prompt");

const EDGE_FUNCTION = path.join(__dirname, "..", "supabase", "functions", "parse-play", "index.ts");
const BLOCK = /(\/\/ BEGIN STATIC_PROMPT[^\n]*\n)[\s\S]*?(\/\/ END STATIC_PROMPT)/;

function renderBlock() {
  return `const STATIC_PROMPT = ${JSON.stringify(buildStaticPrompt())};\n`;
}

// the prompt text currently baked into the edge function
function readEdgePrompt(source = fs.readFileSync(EDGE_FUNCTION, "utf8")) {
  const match = source.match(/\/\/ BEGIN STATIC_PROMPT[^\n]*\nconst STATIC_PROMPT = (.*);\n\/\/ END STATIC_PROMPT/);
  return match ? JSON.parse(match[1]) : null;
}

if (require.main === module) {
  const source = fs.readFileSync(EDGE_FUNCTION, "utf8");
  if (!BLOCK.test(source)) {
    console.error(`Could not find the STATIC_PROMPT markers in ${EDGE_FUNCTION}`);
    process.exit(1);
  }
  fs.writeFileSync(EDGE_FUNCTION, source.replace(BLOCK, (_, begin, end) => begin + renderBlock() + end));
  console.log(`Updated the prompt in ${path.relative(process.cwd(), EDGE_FUNCTION)}`);
}

module.exports = { EDGE_FUNCTION, readEdgePrompt };
