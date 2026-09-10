// 测试用的「生产源码」加载器：把 index.html 引入的 js/ 文件按顺序拼成一整段，
// 让各测试还能像以前一样用正则抠出真实函数。
// 设了 CHAT_LITE_TEST_REF 就改从那个历史提交读（拆分前是单文件 index.html，
// 拆分后是多文件），用来证明测试能抓住修复前的 bug。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const ref = process.env.CHAT_LITE_TEST_REF;

function gitShow(path) {
  return execFileSync("git", ["show", `${ref}:${path}`], { cwd: root, encoding: "utf8" });
}

function read(path) {
  return ref ? gitShow(path) : readFileSync(new URL(path, root), "utf8");
}

// 拆分前的单文件：脚本整体缩进两格，去掉后才和拆分后的文件长得一样。
function dedent(text) {
  return text.split("\n").map((line) => (line.startsWith("  ") ? line.slice(2) : line)).join("\n");
}

const html = read("index.html");
const inline = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
const files = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);

export const source = inline
  ? dedent(inline)
  : files.map((path) => read(path)).join("\n");

assert.ok(source.trim(), "index.html must inline or reference the app script");
