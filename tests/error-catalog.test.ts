import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { HTTP_LAYER_ERRORS, collectDomainErrors } from "../src/contracts/error-catalog.js";

test("every error code keeps one HTTP status and the published catalogue is current",()=>{
  const entries=collectDomainErrors("src");
  assert.ok(entries.length>100);
  const drifting=entries.filter(e=>e.statuses.length!==1).map(e=>`${e.code}: ${e.statuses.join(",")}`);
  assert.deepEqual(drifting,[]);
  const clash=entries.filter(e=>HTTP_LAYER_ERRORS.some(h=>h.code===e.code)).map(e=>e.code);
  assert.deepEqual(clash,[]);
  const doc=fs.readFileSync("docs/ERRORS.md","utf8");
  const missing=entries.filter(e=>!doc.includes(`| \`${e.code}\` |`)).map(e=>e.code);
  assert.deepEqual(missing,[],"run npm run errors to refresh docs/ERRORS.md");
});
