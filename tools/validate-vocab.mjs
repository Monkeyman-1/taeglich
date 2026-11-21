#!/usr/bin/env node
/**
 * Validates vocab.json against the schema the app expects.
 *
 * Run:  node tools/validate-vocab.mjs
 * Exits non-zero with a list of problems, so CI blocks a broken word list
 * before it can reach the deployed app.
 *
 * Every rule here exists because breaking it breaks something visible:
 * see CLAUDE.md for what each field drives.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, "vocab.json");

const TYPES = ["n", "v", "a", "d", "k", "p", "g", "o", "c"];
const ARTICLES = ["der", "die", "das"];
const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

// same folding the app uses to compare answers
const fold = s => (s || "").toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/[.,!?;:"'’„“]/g, "").replace(/\s+/g, " ").trim();

const errors = [];
const warnings = [];
const err = (i, id, msg) => errors.push(`items[${i}]${id ? ` (${id})` : ""}: ${msg}`);
const warn = (i, id, msg) => warnings.push(`items[${i}]${id ? ` (${id})` : ""}: ${msg}`);

let doc;
try {
  doc = JSON.parse(readFileSync(FILE, "utf8"));
} catch (e) {
  console.error(`vocab.json is not valid JSON:\n  ${e.message}`);
  process.exit(1);
}

const items = Array.isArray(doc) ? doc : doc.items;
if (!Array.isArray(items)) {
  console.error('vocab.json must be {"schemaVersion":1,"items":[...]} or a bare array.');
  process.exit(1);
}
if (!items.length) {
  console.error("vocab.json has no items — the app would have nothing to teach.");
  process.exit(1);
}

const seen = new Map();
items.forEach((it, i) => {
  const id = typeof it.id === "string" ? it.id : "";

  if (!it || typeof it !== "object" || Array.isArray(it)) return err(i, "", "must be an object");
  if (!id) err(i, "", "missing required string field: id");
  else if (seen.has(id)) err(i, id, `duplicate id, already used by items[${seen.get(id)}]`);
  else seen.set(id, i);

  if (!TYPES.includes(it.t)) err(i, id, `t must be one of ${TYPES.join(", ")} (got ${JSON.stringify(it.t)})`);
  for (const f of ["de", "en", "lv", "tp"]) {
    if (typeof it[f] !== "string" || !it[f].trim()) err(i, id, `missing required non-empty string field: ${f}`);
  }
  if (typeof it.lv === "string" && !LEVELS.includes(it.lv)) {
    err(i, id, `lv must be one of ${LEVELS.join(", ")} (got ${JSON.stringify(it.lv)})`);
  }

  // nouns drive the der/die/das drill and the gender colour coding
  if (it.t === "n") {
    if (!ARTICLES.includes(it.art)) err(i, id, `nouns need art to be der, die or das (got ${JSON.stringify(it.art)})`);
    if (typeof it.de === "string" && /^(der|die|das)\s/i.test(it.de)) {
      err(i, id, `de must be the bare noun — the article belongs in art (got ${JSON.stringify(it.de)})`);
    }
  } else if (it.art !== undefined) {
    warn(i, id, `art is only meaningful for nouns (t:"n"), ignoring on t:"${it.t}"`);
  }

  // s = [german sentence, english sentence, target word]
  if (it.s !== undefined) {
    if (!Array.isArray(it.s) || it.s.length !== 3 || it.s.some(x => typeof x !== "string" || !x.trim())) {
      err(i, id, "s must be [german sentence, english sentence, target word], all non-empty strings");
    } else {
      const [de, , word] = it.s;
      // the cloze card blanks the target out of the sentence; if it isn't there
      // the learner is asked to fill a gap that was never made
      if (!de.includes("___") && !de.includes(word)) {
        err(i, id, `s[2] ${JSON.stringify(word)} does not appear in s[0] — the gap card cannot be built`);
      }
    }
  } else if (it.t === "g") {
    err(i, id, 'grammar drills (t:"g") require s — the drill is the sentence');
  }

  // drills explain their rule after every answer, so an empty explanation is a dead end
  if ((it.t === "o" || it.t === "c") && (typeof it.why !== "string" || !it.why.trim())) {
    err(i, id, `${it.t === "o" ? "word-order" : "case"} drills need why: a plain-English rule shown after answering`);
  }

  // word order: de = "Morgen | *fahre | ich | nach Berlin." (| splits tiles, * marks a verb part)
  if (it.t === "o" && typeof it.de === "string") {
    const chunks = src => String(src).split("|").map(s => s.trim()).filter(Boolean).map(c => c.replace(/^\*/, "").trim());
    const bag = src => chunks(src).map(fold).sort().join("\u0000");
    const parts = chunks(it.de);
    if (parts.length < 3) err(i, id, "word-order drills need at least 3 chunks split by |");
    if (!/\|\s*\*/.test("|" + it.de)) err(i, id, "mark at least one verb chunk with * so the answer can show the verb positions");
    if (it.fix !== undefined && (!Number.isInteger(it.fix) || it.fix < 0 || it.fix > parts.length - 2)) {
      err(i, id, `fix must be a whole number from 0 to ${parts.length - 2} (leave at least two tiles to move)`);
    }
    if (it.alt !== undefined) {
      if (!Array.isArray(it.alt)) err(i, id, "alt must be a list of other correct orders");
      else it.alt.forEach((a, j) => {
        // an alternative made of different tiles could never be built, so it would never match
        if (bag(a) !== bag(it.de)) err(i, id, `alt[${j}] uses different chunks from de`);
      });
    }
  }

  // case drills: one ___ gap and a set of choices that includes the answer
  if (it.t === "c" && typeof it.de === "string") {
    if (it.de.split("___").length !== 2) err(i, id, "case drills need exactly one ___ gap in de");
    if (!Array.isArray(it.opts) || it.opts.length < 2 || it.opts.some(o => typeof o !== "string" || !o.trim())) {
      err(i, id, "opts must list at least 2 choices");
    } else {
      if (new Set(it.opts).size !== it.opts.length) err(i, id, "opts has the same choice twice");
      if (!it.opts.includes(it.ans)) err(i, id, `ans ${JSON.stringify(it.ans)} is not one of opts`);
    }
  }
});

const fmt = (label, list) => list.length ? `\n${label}:\n  ${list.join("\n  ")}` : "";

if (errors.length) {
  console.error(`vocab.json: ${errors.length} error${errors.length > 1 ? "s" : ""} in ${items.length} items${fmt("Errors", errors)}${fmt("Warnings", warnings)}`);
  process.exit(1);
}

const byLevel = {};
const byType = {};
items.forEach(it => {
  byLevel[it.lv] = (byLevel[it.lv] || 0) + 1;
  byType[it.t] = (byType[it.t] || 0) + 1;
});
console.log(`vocab.json OK — ${items.length} items, ${seen.size} unique ids`);
console.log(`  by level: ${LEVELS.filter(l => byLevel[l]).map(l => `${l}=${byLevel[l]}`).join("  ")}`);
console.log(`  by type:  ${TYPES.filter(t => byType[t]).map(t => `${t}=${byType[t]}`).join("  ")}`);
if (warnings.length) console.log(fmt("Warnings", warnings).trimStart());
